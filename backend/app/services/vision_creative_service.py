"""
vision_creative_service.py

Three creative vision features with full language support:
1. What If Reality Engine  — reimagine scene in a scenario + generate image
2. Object Biographies      — fictional life story of a detected object + origin image
3. Scene Director          — treat scene as movie, generate poster + trailer script

All features:
- Respond in the user's selected language (Kannada/Tamil/Telugu/Hindi/English)
- Use oxlo_fast (no SDK retries) with 20s timeout per call
- Share the rate-limit tracker from vision_service
"""

import asyncio
import json
import logging
from typing import List
from openai.types.chat import ChatCompletionContentPartParam
from app.services.oxlo_client import oxlo_fast
from app.services.vision_service import _detect, _kimi_is_blocked, _block_kimi, _is_rate_limit
from app.services.image_service import generate_image
from app.config import MODELS, TEMPERATURE, SUPPORTED_LANGUAGES
from app.models.schemas import DetectionBox

logger = logging.getLogger("Oxlo VoxVision.ai.vision_creative")


def _lang_instruction(language: str) -> str:
    """Build a language enforcement prefix for any creative prompt."""
    if language == "en":
        return ""
    lang_info = SUPPORTED_LANGUAGES.get(language, {})
    lang_name = lang_info.get("name", language)
    script = lang_info.get("script", "native script")
    return (
        f"CRITICAL LANGUAGE RULE: You MUST write ALL text (narration, biography, script, title, tagline) "
        f"ONLY in {lang_name} using {lang_name} native {script} characters. "
        f"DO NOT use English, Latin script, or transliteration anywhere. "
        f"Return valid JSON with all string values written in {lang_name} {script}.\n\n"
    )


async def _safe_detect(image_base64: str) -> List[DetectionBox]:
    """Kimi → YOLO fallback detection. Never raises."""
    try:
        return await _detect(image_base64)
    except Exception as e:
        logger.warning("Detection failed in creative pipeline: %s", e)
        return []


# ── Prompts ──────────────────────────────────────────────────────────────────

SCENE_DESCRIBE_PROMPT = """Look at this camera frame carefully. Describe the scene in rich detail in 2-3 sentences:
- What objects are present and their colors/materials
- The environment/setting (room type, lighting, mood)
- Any people and what they are doing
- Spatial relationships between objects

Be specific and visual. This description will be used to generate an alternate version of this scene."""

WHAT_IF_MERGE_PROMPT = """{lang_instruction}You are a creative director for visual scenes.

Given this description of a real scene:
"{scene_description}"

And detected objects: {object_labels}

The user wants to imagine: "{what_if_prompt}"

Your task:
1. Write a detailed image generation prompt (3-4 sentences) that reimagines the EXACT scene in the "what if" scenario.
   - Keep the same spatial layout and composition
   - Transform each real object into its alternate-reality equivalent
   - Add environmental details matching the scenario
   - Make it photorealistic and cinematic

2. Write a short narration (2-3 sentences) describing what changed, spoken like a documentary narrator.
   {lang_note}

Return ONLY valid JSON:
{{"image_prompt": "...", "narration": "..."}}"""


BIOGRAPHY_PROMPT = """{lang_instruction}You are a master storyteller with the imagination of Gabriel García Márquez.

Look at this image. The user has selected an object: "{object_label}".
{bbox_hint}

Your task:
1. Identify the specific object clearly
2. Imagine its complete life story — where it was created, the hands it passed through, the memories it witnessed, and how it arrived here. Be vivid, emotional, and cinematic.
3. Write the biography in 3-4 sentences, in the style of a documentary narrator
   {lang_note}
4. Describe the most vivid scene from its origin story in 1-2 sentences in English (this will become a generated image)

Return ONLY valid JSON:
{{"object_name": "...", "biography": "...", "origin_scene": "..."}}"""


SCENE_DIRECTOR_PROMPT = """{lang_instruction}You are a legendary Hollywood movie pitch creator.

Look at this camera frame. Analyze everything: the people, objects, lighting, mood, setting, time of day, colors.

Detected objects in the scene: {object_labels}

Your task — treat this real scene as a movie still and create:
1. **genre**: The most fitting movie genre (Thriller, Sci-Fi, Horror, Romance, Comedy, Drama, Action, Mystery, Fantasy, Noir) — keep in English
2. **title**: A compelling, original movie title (2-4 words) {lang_note}
3. **tagline**: A movie tagline (one punchy line) {lang_note}
4. **trailer_script**: A 2-3 sentence dramatic movie trailer narration {lang_note}
5. **poster_prompt**: A detailed image generation prompt for a professional movie poster — in English

Return ONLY valid JSON:
{{"genre": "...", "title": "...", "tagline": "...", "trailer_script": "...", "poster_prompt": "..."}}"""


# ── Helper: call Kimi vision with timeout + rate-limit awareness ──────────────

def _is_transient(e: Exception) -> bool:
    err = str(e).lower()
    return any(c in err for c in ["502", "503", "529", "request failed", "rate", "timeout", "overloaded", "429", "too many"])


async def _kimi_vision(
    image_base64: str,
    text_prompt: str,
    max_tokens: int = 400,
) -> str:
    """Send image + text prompt to Kimi vision. Fast timeout, rate-limit aware."""
    content: List[ChatCompletionContentPartParam] = [
        {"type": "text", "text": text_prompt},
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
        },
    ]

    models_to_try: list[str] = [MODELS["vision"]] + list(MODELS.get("vision_fallback", []))
    last_error: Exception = RuntimeError("No vision models available")

    for model in models_to_try:
        if model == MODELS["vision"] and _kimi_is_blocked():
            logger.info("Creative: skipping Kimi (rate-limited)")
            continue
        try:
            logger.info("_kimi_vision call — model=%s", model)
            response = await asyncio.wait_for(
                oxlo_fast.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": content}],
                    max_tokens=max_tokens,
                    temperature=TEMPERATURE,
                ),
                timeout=20.0,
            )
            return response.choices[0].message.content or ""
        except asyncio.TimeoutError:
            logger.warning("_kimi_vision timed out — model=%s, trying next", model)
            last_error = RuntimeError(f"{model} timed out")
        except Exception as e:
            last_error = e
            if _is_transient(e):
                if _is_rate_limit(e):
                    _block_kimi()
                logger.warning("_kimi_vision transient error — model=%s: %s", model, e)
            else:
                logger.warning("_kimi_vision error — model=%s: %s", model, e)

    raise last_error


def _parse_json(text: str) -> dict:
    """Extract JSON from LLM response, handling markdown code blocks."""
    text = text.strip()
    if text.startswith("```"):
        lines = [l for l in text.split("\n") if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
        logger.error("Failed to parse JSON from LLM response: %s", text[:200])
        raise ValueError("Could not parse AI response as JSON")


# ═══════════════════════════════════════════════════════════════════════════════
# Feature 1: "What If" Reality Engine
# ═══════════════════════════════════════════════════════════════════════════════

async def what_if_reality(
    image_base64: str,
    what_if_prompt: str,
    history: List[dict],
    language: str = "en",
) -> dict:
    """
    Reimagine the camera scene in a "what if" scenario.

    Pipeline:
    1. Detection + Scene description (parallel)
    2. Kimi generates image prompt + narration IN the selected language
    3. AI generates the reimagined scene image
    4. Returns scene description, narration (in language), generated image
    """
    lang_info = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES["en"])
    lang_name = lang_info.get("name", "English")
    logger.info("What If Reality: '%s' lang=%s (%s)", what_if_prompt, language, lang_name)

    lang_instruction = _lang_instruction(language)
    lang_note = f"(Write this in {lang_name} native script)" if language != "en" else ""

    # Step 1: YOLO detection + Scene description IN PARALLEL
    detections, scene_desc = await asyncio.gather(
        _safe_detect(image_base64),
        _kimi_vision(image_base64, SCENE_DESCRIBE_PROMPT, max_tokens=300),
    )

    object_labels = list({d.label for d in detections if d.confidence >= 0.50})
    labels_str = ", ".join(object_labels) if object_labels else "none detected"

    # Step 2: Generate merged image prompt + narration (in selected language)
    merge_prompt = WHAT_IF_MERGE_PROMPT.format(
        lang_instruction=lang_instruction,
        scene_description=scene_desc,
        object_labels=labels_str,
        what_if_prompt=what_if_prompt,
        lang_note=lang_note,
    )
    merged_response = await _kimi_vision(image_base64, merge_prompt, max_tokens=500)
    parsed = _parse_json(merged_response)

    image_prompt = parsed.get("image_prompt", f"A photorealistic scene: {what_if_prompt}")
    narration = parsed.get("narration", "An alternate reality has been generated.")

    # Step 3: Generate the alternate reality image (always in English prompt)
    img_result = await generate_image(image_prompt)

    logger.info("What If complete. Scene: %d chars, Narration: %d chars",
                len(scene_desc), len(narration))
    return {
        "scene_description": scene_desc,
        "narration": narration,
        "generated_image_b64": img_result["image_b64"],
        "detections": detections,
        "model_used": img_result["model_used"],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Feature 2: Object Biographies
# ═══════════════════════════════════════════════════════════════════════════════

async def object_biography(
    image_base64: str,
    object_label: str | None = None,
    object_bbox: list[float] | None = None,
    history: List[dict] = [],
    language: str = "en",
) -> dict:
    """
    Tell the fictional life story of a detected object.

    Pipeline:
    1. Kimi identifies the object + imagines its biography IN selected language
    2. Kimi describes an origin scene (always in English for image generation)
    3. AI generates origin story image
    4. Returns object name, biography (in language), origin image
    """
    label = object_label or "the most prominent object"
    bbox_hint = ""
    if object_bbox:
        bbox_hint = (
            f"The object is at approximately: "
            f"left={object_bbox[0]:.0%}, top={object_bbox[1]:.0%}, "
            f"width={object_bbox[2]:.0%}, height={object_bbox[3]:.0%} of the frame."
        )

    lang_info = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES["en"])
    lang_name = lang_info.get("name", "English")
    logger.info("Object Biography: '%s' lang=%s (%s)", label, language, lang_name)

    lang_instruction = _lang_instruction(language)
    lang_note = (
        f"(Write the biography in {lang_name} native script — NOT English)"
        if language != "en" else ""
    )

    prompt = BIOGRAPHY_PROMPT.format(
        lang_instruction=lang_instruction,
        object_label=label,
        bbox_hint=bbox_hint,
        lang_note=lang_note,
    )
    bio_response = await _kimi_vision(image_base64, prompt, max_tokens=600)
    parsed = _parse_json(bio_response)

    object_name = parsed.get("object_name", label)
    biography = parsed.get("biography", "This object has a mysterious past...")
    origin_scene = parsed.get(
        "origin_scene",
        f"A craftsman's workshop where a {label} is being created with care, warm dramatic lighting"
    )

    # Generate image from origin scene (English prompt for best image quality)
    origin_prompt = (
        f"Photorealistic, cinematic scene: {origin_scene}. "
        "Warm dramatic lighting, nostalgic atmosphere, ultra detailed, 8k quality."
    )
    img_result = await generate_image(origin_prompt)

    logger.info("Object Biography complete for '%s'", object_name)
    return {
        "object_name": object_name,
        "biography": biography,
        "origin_image_b64": img_result["image_b64"],
        "model_used": img_result["model_used"],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Feature 3: Scene Director (Movie Poster Generator)
# ═══════════════════════════════════════════════════════════════════════════════

async def scene_director(
    image_base64: str,
    history: List[dict] = [],
    language: str = "en",
) -> dict:
    """
    Treat the camera scene as a movie still and create a full movie package.

    Pipeline:
    1. Detection + Scene Director analysis (parallel)
    2. Kimi creates title/tagline/trailer script IN selected language
    3. AI generates movie poster
    4. Returns full movie package with language-native text
    """
    lang_info = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES["en"])
    lang_name = lang_info.get("name", "English")
    logger.info("Scene Director: lang=%s (%s)", language, lang_name)

    lang_instruction = _lang_instruction(language)
    lang_note = (
        f"in {lang_name} native script (NOT English)"
        if language != "en" else ""
    )

    # Step 1: Detection + Director analysis in parallel
    detections, director_response = await asyncio.gather(
        _safe_detect(image_base64),
        _kimi_vision(
            image_base64,
            SCENE_DIRECTOR_PROMPT.format(
                lang_instruction=lang_instruction,
                object_labels="analyzing scene...",
                lang_note=lang_note,
            ),
            max_tokens=700,
        ),
    )

    # If we got good detections, re-run for better results (unless Kimi is now blocked)
    object_labels = list({d.label for d in detections if d.confidence >= 0.50})
    if object_labels and not _kimi_is_blocked():
        try:
            director_response = await _kimi_vision(
                image_base64,
                SCENE_DIRECTOR_PROMPT.format(
                    lang_instruction=lang_instruction,
                    object_labels=", ".join(object_labels),
                    lang_note=lang_note,
                ),
                max_tokens=700,
            )
        except Exception as e:
            logger.warning("Scene Director re-run with labels failed: %s — using initial", e)

    parsed = _parse_json(director_response)

    genre = parsed.get("genre", "Drama")
    title = parsed.get("title", "Untitled")
    tagline = parsed.get("tagline", "Every frame tells a story.")
    trailer_script = parsed.get("trailer_script", "In a world unlike any other...")
    poster_prompt = parsed.get(
        "poster_prompt",
        f"Professional cinematic movie poster for a {genre} film titled '{title}'. Dramatic lighting."
    )

    # Generate movie poster (always English prompt for best image gen quality)
    full_poster_prompt = (
        f"{poster_prompt} "
        "Professional movie poster design, cinematic composition, dramatic lighting, film grain texture."
    )
    img_result = await generate_image(full_poster_prompt)

    logger.info("Scene Director complete: '%s' (%s)", title, genre)
    return {
        "genre": genre,
        "title": title,
        "tagline": tagline,
        "trailer_script": trailer_script,
        "poster_image_b64": img_result["image_b64"],
        "detections": detections,
        "model_used": img_result["model_used"],
    }
