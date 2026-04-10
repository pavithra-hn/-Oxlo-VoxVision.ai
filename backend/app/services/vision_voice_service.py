"""
vision_voice_service.py — Smart Vision Voice Assistant Service

Gives the Vision Mode a conversational voice assistant brain:
  • Greeting analysis  — first frame → personalized greeting focused on the USER
  • Vision intent      — does this transcript need the camera?
  • Vision-aware chat  — frame + transcript → Vision LLM
  • Text-only chat     — no camera needed → Chat LLM (faster, cheaper)
  • Recapture detect   — AI can't see clearly → ask user to reposition

Reuses existing infrastructure:
  - vision_service._narrate_oxlo / _narrate_groq  for VLM calls
  - chat_service.chat_full                        for text-only chat
  - stt_service.transcribe                        for STT
  - tts_service.synthesize                        for TTS
"""

import asyncio
import re
import logging
from typing import List

from openai.types.chat import ChatCompletionContentPartParam

from app.services.oxlo_client import oxlo_fast, groq
from app.services.chat_service import chat_full
from app.services.response_cleaner import clean_response
from app.config import MODELS, TEMPERATURE, SUPPORTED_LANGUAGES

logger = logging.getLogger("Oxlo VoxVision.ai.vision_voice")


# ─────────────────────────────────────────────────────────────────────────────
# GREETING SYSTEM PROMPTS
# ─────────────────────────────────────────────────────────────────────────────

GREETING_SYSTEM_EN = (
    "You are Oxlo VoxVision AI — a friendly assistant who can SEE the user through "
    "their webcam. This is your FIRST look at them in this session.\n\n"
    "PRIORITY: Focus on the PERSON first — their appearance, clothing, expression, "
    "posture, any accessories. Then briefly note the environment.\n\n"
    "Give a warm, natural greeting in 2-3 sentences:\n"
    "1. Describe the person naturally (what they're wearing, how they look)\n"
    "2. One brief environmental observation\n"
    "3. End with an inviting question like 'How can I help you today?'\n\n"
    "TONE: Like a friend on a video call. Warm, not creepy. Brief, not a list.\n\n"
    "GOOD: \"Hey! You're looking sharp in that black jacket — looks like you're "
    "at your desk with some nice warm lighting. What's on your mind today?\"\n\n"
    "BAD: \"I can detect: 1 person, 1 laptop, 1 chair, 1 desk, 1 lamp...\" "
    "(never list objects mechanically)\n\n"
    "FORMATTING: Plain text only. No markdown, no bullet points, no headers. "
    "Just natural spoken sentences. Use contractions (you're, it's, that's). "
    "NEVER use ** or # or ` or any formatting marks."
)


def _build_greeting_system(language: str) -> str:
    """Return a language-aware greeting system prompt for the first frame."""
    if language == "en":
        return GREETING_SYSTEM_EN

    lang_info = SUPPORTED_LANGUAGES.get(language, {})
    lang_name = lang_info.get("name", language)
    script = lang_info.get("script", "native script")

    return (
        f"You are Oxlo VoxVision AI — a friendly assistant who can SEE the user "
        f"through their webcam. This is your FIRST look at them.\n\n"
        f"CRITICAL LANGUAGE RULE: Respond ONLY in {lang_name} using {script} script. "
        f"NO English, NO transliteration.\n\n"
        f"PRIORITY: Focus on the PERSON first — appearance, clothing, expression. "
        f"Then briefly note environment.\n\n"
        f"Give a warm greeting in 2-3 sentences in {lang_name}. "
        f"End with an inviting question.\n"
        f"TONE: Like a friend on a video call. Warm, natural.\n"
        f"FORMATTING: Plain text only. No markdown."
    )


# ─────────────────────────────────────────────────────────────────────────────
# VISION CHAT SYSTEM PROMPTS (for ongoing conversation with camera)
# ─────────────────────────────────────────────────────────────────────────────

VISION_CHAT_SYSTEM_EN = (
    "You are Oxlo VoxVision AI — a friendly AI assistant who can SEE the user "
    "through their webcam AND hear them speak. You are having a live voice "
    "conversation with visual awareness.\n\n"
    "The user has spoken to you and you can also see their webcam frame.\n\n"
    "RULES:\n"
    "1. PRIORITIZE the PERSON — if you can see them, focus on them first\n"
    "2. Answer their spoken question using BOTH what you hear AND what you see\n"
    "3. Be specific about what you observe — brand names, colors, textures, expressions\n"
    "4. If they ask about their appearance, give honest, constructive, friendly feedback\n"
    "5. If they show you objects/ingredients, identify them specifically\n"
    "6. Keep responses conversational — 2-4 sentences max, like talking to a friend\n"
    "7. If you CANNOT see something clearly, say so honestly and suggest how to fix it "
    "(e.g., 'Could you hold it closer?' or 'The lighting is a bit dim')\n\n"
    "FORMATTING: Plain text only. No markdown, no bullet points for short answers. "
    "Use natural spoken language. Contractions (you're, it's, don't).\n"
    "NEVER use ** or # or ` or any formatting marks.\n"
    "For lists of items (ingredients etc.) you may use bullet points (•)."
)


def _build_vision_chat_system(language: str) -> str:
    """Return a language-aware system prompt for vision-aware conversation."""
    if language == "en":
        return VISION_CHAT_SYSTEM_EN

    lang_info = SUPPORTED_LANGUAGES.get(language, {})
    lang_name = lang_info.get("name", language)
    script = lang_info.get("script", "native script")

    return (
        f"You are Oxlo VoxVision AI — a friendly AI assistant who can SEE the user "
        f"through their webcam AND hear them speak.\n\n"
        f"CRITICAL: Respond ONLY in {lang_name} using {script} script. "
        f"NO English, NO transliteration.\n\n"
        f"PRIORITIZE the PERSON. Answer their question using what you hear AND see. "
        f"Be specific about observations. 2-4 sentences, conversational.\n"
        f"If you can't see clearly, say so and suggest how to fix it.\n"
        f"FORMATTING: Plain text only. No markdown."
    )


# ─────────────────────────────────────────────────────────────────────────────
# VISION INTENT DETECTION
# ─────────────────────────────────────────────────────────────────────────────

# Compiled regex patterns for visual intent detection
_VISION_PATTERNS = [
    # Appearance / clothing / looking
    re.compile(r"(how|what).*(look|looking|dressed|wearing|outfit|appearance)", re.I),
    re.compile(r"(am i|do i).*(look|ready|dressed|presentable|match|fit)", re.I),

    # Object identification
    re.compile(r"(what is|what's|what are).*(this|that|these|those|here|there|in my hand)", re.I),
    re.compile(r"(can you|do you|could you).*(see|spot|notice|identify|recognize|read|tell)", re.I),
    re.compile(r"(show|showing|holding|have here|look at this|check this)", re.I),

    # Environment
    re.compile(r"(around me|my room|my desk|behind me|in front|background|surroundings)", re.I),
    re.compile(r"(color|brand|label|text|writing|sign|logo|name on)", re.I),

    # Ingredient / object enumeration
    re.compile(r"(ingredient|item|thing|stuff|object).*(have|see|here|available|show)", re.I),
    re.compile(r"(what can|what should).*(cook|make|prepare|do with|bake)", re.I),
    re.compile(r"(recipe|dish).*(with|from|using).*(this|these|what)", re.I),

    # Explicit vision triggers
    re.compile(r"(check|scan|analyze|examine|inspect|look at|describe)", re.I),
    re.compile(r"(see me|see this|see that|see my|see the|see what)", re.I),
    re.compile(r"(on the table|in the frame|on screen|visible|in front of me)", re.I),

    # Implicit — demonstrative pronouns as sentence starters
    re.compile(r"^(this|that|these|those)\s", re.I),

    # Hindi vision triggers
    re.compile(r"(दिख|देख|कैसा|कैसी|पहन|दिखाओ|ये क्या|कैसे लग)", re.I),
    # Kannada vision triggers
    re.compile(r"(ನೋಡ|ಕಾಣ|ಹೇಗೆ|ಹೇಗಿದೆ|ತೋರಿಸ|ಏನಿದು)", re.I),
    # Tamil vision triggers
    re.compile(r"(பார்|தெரி|எப்படி|காட்டு|என்ன இது)", re.I),
    # Telugu vision triggers
    re.compile(r"(చూడ|కనిపి|ఎలా|చూపించు|ఏమిటి ఇది)", re.I),
]


def detect_vision_need(transcript: str) -> bool:
    """
    Does this user utterance need the webcam frame?

    Returns True if the transcript matches any visual intent pattern.
    Fast regex-based check — runs in <1ms.
    """
    if not transcript or not transcript.strip():
        return False

    text = transcript.strip()
    for pattern in _VISION_PATTERNS:
        if pattern.search(text):
            logger.info("Vision intent detected: pattern=%s", pattern.pattern[:50])
            return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE GENERATION INTENT DETECTION (Hybrid: keyword + regex, extensible)
# ─────────────────────────────────────────────────────────────────────────────

_IMAGE_GEN_KEYWORDS = [
    "generate", "create image", "make image", "draw me", "draw my",
    "anime", "cartoon", "transform me", "turn me into", "make me look",
    "stylize", "artistic", "convert me", "render me", "pixel art",
    "sketch me", "paint me", "caricature", "manga", "superhero",
    "avatar", "portrait style", "oil painting", "watercolor",
]

_IMAGE_GEN_PATTERNS = [
    re.compile(r"(generate|create|make|draw|render)\s+(a|an|my|me)\s+(image|picture|photo|portrait)", re.I),
    re.compile(r"(turn|transform|convert|change)\s+(me|my|this|myself)\s+(into|to|as)", re.I),
    re.compile(r"(as|like)\s+(an?\s+)?(anime|cartoon|manga|superhero|sketch|painting)", re.I),
    re.compile(r"(anime|cartoon|manga|pixel.?art|sketch|oil.?paint|watercolor)\s+(version|style|character|form)", re.I),
    re.compile(r"(make|create)\s+me\s+(look|appear)\s+(like|as)", re.I),
    # Hindi
    re.compile(r"(बनाओ|बनाना|तस्वीर|चित्र|एनिमे|कार्टून)", re.I),
    # Kannada
    re.compile(r"(ಮಾಡು|ಚಿತ್ರ|ಅನಿಮೆ|ಕಾರ್ಟೂನ್)", re.I),
]


def detect_image_gen_need(transcript: str) -> bool:
    """
    Does this user utterance request image generation?

    Hybrid detection: fast keyword check first, then regex patterns.
    Designed to be extensible — replace with LLM classifier later.

    Returns True if image generation is needed.
    """
    if not transcript or not transcript.strip():
        return False

    text = transcript.strip().lower()

    # Fast keyword check first
    for keyword in _IMAGE_GEN_KEYWORDS:
        if keyword in text:
            logger.info("Image gen intent (keyword): '%s'", keyword)
            return True

    # Regex patterns for more complex phrasing
    for pattern in _IMAGE_GEN_PATTERNS:
        if pattern.search(transcript.strip()):
            logger.info("Image gen intent (regex): %s", pattern.pattern[:50])
            return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# INTENT ROUTER — Central routing layer (extensible for future modes)
# ─────────────────────────────────────────────────────────────────────────────

def route_intent(transcript: str, has_frame: bool) -> str:
    """
    Central intent router for Vision Mode.

    Routes to one of:
      - "image_generation"  → user wants to generate/transform an image
      - "vision_analysis"   → user needs the camera frame analyzed
      - "text_chat"         → general question, no camera needed

    Priority: image_generation > vision_analysis > text_chat
    Extensible: add "video", "multimodal_chain", "tools" here later.
    """
    # Image generation takes highest priority
    if detect_image_gen_need(transcript):
        return "image_generation"

    # Vision analysis needs a frame
    if detect_vision_need(transcript) and has_frame:
        return "vision_analysis"

    # Default: text-only chat (fastest)
    return "text_chat"


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE GENERATION — Direct img2img (primary) | VLM+text2img (fallback)
# ─────────────────────────────────────────────────────────────────────────────

# Keywords that indicate the user wants their own image transformed
_SELF_TRANSFORM_KEYWORDS = [
    "my image", "my photo", "my face", "me as", "me into", "me look",
    "myself", "transform me", "turn me", "convert me", "make me",
    "how do i look", "how would i look", "capture my", "my frame",
]

# Style keywords and their optimal img2img strength
_STYLE_MAP = {
    "anime":        {"prompt_style": "high quality anime style portrait, Studio Ghibli inspired", "strength": 0.7},
    "cartoon":      {"prompt_style": "cartoon style illustration, vibrant colors", "strength": 0.7},
    "manga":        {"prompt_style": "manga style black and white illustration, detailed ink work", "strength": 0.75},
    "pixel art":    {"prompt_style": "pixel art retro game style portrait, 16-bit", "strength": 0.8},
    "sketch":       {"prompt_style": "pencil sketch drawing, detailed shading", "strength": 0.65},
    "oil painting": {"prompt_style": "classical oil painting portrait, Renaissance style", "strength": 0.7},
    "watercolor":   {"prompt_style": "watercolor painting, soft artistic brush strokes", "strength": 0.7},
    "superhero":    {"prompt_style": "superhero comic book style, dynamic pose, cape", "strength": 0.75},
    "cyberpunk":    {"prompt_style": "cyberpunk neon-lit portrait, futuristic", "strength": 0.7},
    "fantasy":      {"prompt_style": "fantasy RPG character portrait, magical aura", "strength": 0.7},
    "steampunk":    {"prompt_style": "steampunk Victorian portrait, gears and goggles", "strength": 0.75},
    "3d render":    {"prompt_style": "3D rendered character, Pixar style, high quality", "strength": 0.8},
    "chibi":        {"prompt_style": "cute chibi anime character, big head small body", "strength": 0.8},
    "comic":        {"prompt_style": "comic book illustration, bold outlines, pop art", "strength": 0.75},
    "traditional":  {"prompt_style": "wearing traditional Indian attire, ornate clothing, cultural dress", "strength": 0.6},
    "formal":       {"prompt_style": "wearing formal business attire, professional portrait", "strength": 0.55},
    "vintage":      {"prompt_style": "vintage 1960s photograph, sepia tones, retro", "strength": 0.65},
}


def _detect_style(user_prompt: str) -> tuple[str, str, float]:
    """Extract style from user prompt. Returns (style_name, prompt_style, strength)."""
    lower = user_prompt.lower()
    for style_name, config in _STYLE_MAP.items():
        if style_name in lower:
            return style_name, config["prompt_style"], config["strength"]
    return "anime", _STYLE_MAP["anime"]["prompt_style"], _STYLE_MAP["anime"]["strength"]


def _is_self_transform(user_prompt: str) -> bool:
    """Does the user want to transform THEIR OWN image (vs generate a new one)?"""
    lower = user_prompt.lower()
    return any(kw in lower for kw in _SELF_TRANSFORM_KEYWORDS)


async def vision_image_generate(
    frame_b64: str,
    user_prompt: str,
    language: str = "en",
) -> dict:
    """
    Generate/transform an image from the user's camera frame.

    Two modes:
    A) Self-transform ("make me anime") → img2img: camera frame + style prompt
    B) Pure generation ("generate image of a cat") → text-to-image: prompt only

    Fallback chain:
    1. img2img via /v1/images/edits (direct frame → styled image)
    2. VLM describe + text-to-image (if img2img not available)

    Returns: {
        "response": str,
        "generated_image_b64": str,
        "image_generated": True,
        "model_used": str,
        "vision_used": True,
    }
    """
    from app.services.image_service import generate_image as text2img
    from app.services.image_service import generate_image_from_image as img2img

    style_name, prompt_style, strength = _detect_style(user_prompt)
    is_self = _is_self_transform(user_prompt)

    try:
        if is_self and frame_b64:
            # ── Mode A: img2img — direct camera frame transformation ────
            img_prompt = (
                f"Transform this person's photo into {prompt_style}. "
                f"Keep the person's likeness and features. "
                f"High quality, detailed, professional. Family-friendly."
            )

            logger.info(
                "img2img: style=%s strength=%.2f self_transform=True",
                style_name, strength,
            )

            result = await img2img(
                image_b64=frame_b64,
                prompt=img_prompt,
                strength=strength,
            )

            friendly_msg = (
                f"Here's your {style_name}-style transformation! "
                f"I transformed your camera image directly into this artistic version."
            )
        else:
            # ── Mode B: text-to-image — pure generation ─────────────────
            img_prompt = (
                f"{user_prompt}. "
                f"Style: {prompt_style}. "
                f"High quality, detailed, professional illustration. Family-friendly."
            )

            logger.info("text2img: style=%s prompt_len=%d", style_name, len(img_prompt))

            result = await text2img(prompt=img_prompt)

            friendly_msg = (
                f"Here's your generated image! "
                f"Created in {style_name} style as requested."
            )

        return {
            "response": clean_response(friendly_msg),
            "generated_image_b64": result["image_b64"],
            "image_generated": True,
            "model_used": result["model_used"],
            "vision_used": True,
            "detections": [],
            "needs_recapture": False,
            "recapture_message": "",
        }

    except Exception as e:
        logger.error("Image generation failed: %s", e)
        return {
            "response": f"I understood your request for a {style_name} image, but generation hit an issue. Please try again!",
            "generated_image_b64": None,
            "image_generated": False,
            "model_used": "",
            "vision_used": True,
            "detections": [],
            "needs_recapture": False,
            "recapture_message": "",
        }


# ─────────────────────────────────────────────────────────────────────────────
# RECAPTURE DETECTION
# ─────────────────────────────────────────────────────────────────────────────

_UNCERTAINTY_SIGNALS = [
    "can't see clearly", "can't make out", "cannot see clearly",
    "too dark", "too blurry", "too far", "not clearly visible",
    "partially visible", "hard to tell", "hard to make out",
    "difficult to identify", "difficult to determine",
    "unable to determine", "unable to see", "unable to identify",
    "cut off", "obscured", "out of frame", "out of focus",
    "can't quite", "not sure what", "hard to read",
]

_RECAPTURE_SUGGESTIONS = {
    "dark": "The image seems a bit dark — could you move towards a light source or turn on a light?",
    "blur": "Things look a bit blurry — try holding steady or moving the object a bit closer.",
    "far": "I can see something but it's a bit far — could you hold it closer to the camera?",
    "partial": "I can only see part of it — could you show the full item to the camera?",
    "default": "I'm having trouble seeing that clearly — could you hold it closer to the camera, maybe in better lighting?",
}


def check_needs_recapture(response: str) -> tuple[bool, str]:
    """
    Check if the vision response signals inability to see clearly.

    Returns (needs_recapture, suggestion_message).
    """
    lower = response.lower()

    for signal in _UNCERTAINTY_SIGNALS:
        if signal in lower:
            logger.info("Recapture needed: signal='%s'", signal)

            # Pick the most relevant suggestion
            if any(w in lower for w in ["dark", "dim", "lighting"]):
                return True, _RECAPTURE_SUGGESTIONS["dark"]
            elif any(w in lower for w in ["blur", "blurry", "focus"]):
                return True, _RECAPTURE_SUGGESTIONS["blur"]
            elif any(w in lower for w in ["far", "small", "tiny", "distance"]):
                return True, _RECAPTURE_SUGGESTIONS["far"]
            elif any(w in lower for w in ["partial", "cut off", "part of"]):
                return True, _RECAPTURE_SUGGESTIONS["partial"]
            else:
                return True, _RECAPTURE_SUGGESTIONS["default"]

    return False, ""


# ─────────────────────────────────────────────────────────────────────────────
# GREETING — First frame analysis
# ─────────────────────────────────────────────────────────────────────────────

async def generate_greeting(
    frame_b64: str,
    language: str = "en",
) -> dict:
    """
    Analyze the first webcam frame and generate a personalized greeting.

    Returns: {"greeting_text": str, "detections": [...]}
    """
    system_prompt = _build_greeting_system(language)

    content: List[ChatCompletionContentPartParam] = [
        {"type": "text", "text": (
            "Look at this webcam frame. This is the first time you're seeing the user. "
            "Give a warm, personalized greeting focused on the PERSON — "
            "what they're wearing, their expression, then briefly the environment. "
            "Keep it natural and friendly, 2-3 sentences."
        )},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]

    # Try Kimi (primary vision model)
    models = [MODELS["vision"]] + list(MODELS.get("vision_fallback", []))

    for model in models:
        try:
            logger.info("Greeting: model=%s lang=%s", model, language)
            resp = await asyncio.wait_for(
                oxlo_fast.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=200,
                    temperature=0.5,  # slightly creative for warmth
                ),
                timeout=12.0,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                cleaned = clean_response(text)
                logger.info("Greeting success: model=%s text='%s'", model, cleaned[:60])
                return {"greeting_text": cleaned, "detections": []}

        except asyncio.TimeoutError:
            logger.warning("Greeting timed out: model=%s", model)
        except Exception as e:
            logger.warning("Greeting error: model=%s: %s", model, e)

    # Fallback — generic greeting if vision fails
    fallback = (
        "Hey! I can see you through the camera but I'm having a moment — "
        "welcome to Oxlo VoxVision AI! How can I help you today?"
    )
    logger.warning("Greeting: all models failed, using fallback")
    return {"greeting_text": fallback, "detections": []}


# ─────────────────────────────────────────────────────────────────────────────
# VISION-AWARE CHAT — Frame + Transcript → Vision LLM
# ─────────────────────────────────────────────────────────────────────────────

async def vision_aware_chat(
    frame_b64: str,
    transcript: str,
    history: list[dict],
    language: str = "en",
) -> dict:
    """
    Send webcam frame + user transcript to Vision LLM for a visual answer.

    Returns: {"response": str, "vision_used": True, "detections": [...],
              "needs_recapture": bool, "recapture_message": str}
    """
    system_prompt = _build_vision_chat_system(language)

    # Build multimodal user message: text (transcript) + image (frame)
    user_content: List[ChatCompletionContentPartParam] = [
        {"type": "text", "text": f"The user said: \"{transcript}\"\n\nLook at their webcam frame and respond to what they said, using what you can see."},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        # Include conversation history (text-only parts)
        *[{"role": m["role"], "content": m["content"]} for m in history[-8:]],
        {"role": "user", "content": user_content},
    ]

    # Try Kimi (primary vision model)
    models = [MODELS["vision"]] + list(MODELS.get("vision_fallback", []))

    for model in models:
        try:
            logger.info("Vision chat: model=%s lang=%s transcript='%s'", model, language, transcript[:50])
            resp = await asyncio.wait_for(
                oxlo_fast.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=400,
                    temperature=TEMPERATURE,
                ),
                timeout=15.0,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                cleaned = clean_response(text)
                needs_recap, recap_msg = check_needs_recapture(cleaned)

                logger.info(
                    "Vision chat success: model=%s recapture=%s text='%s'",
                    model, needs_recap, cleaned[:60]
                )
                return {
                    "response": cleaned,
                    "vision_used": True,
                    "detections": [],
                    "needs_recapture": needs_recap,
                    "recapture_message": recap_msg,
                }

        except asyncio.TimeoutError:
            logger.warning("Vision chat timed out: model=%s", model)
        except Exception as e:
            logger.warning("Vision chat error: model=%s: %s", model, e)

    # Fallback — Groq text-only with context
    logger.info("Vision chat: all vision models failed, Groq text fallback")
    try:
        text_messages = [
            {"role": "system", "content": (
                "You are a helpful AI assistant. The user asked a question "
                "that might relate to what they see. You don't have access to the camera "
                "right now, so answer based on the text alone. Be helpful and suggest "
                "they try again if it's a visual question."
            )},
            *[{"role": m["role"], "content": m["content"]} for m in history[-6:]],
            {"role": "user", "content": transcript},
        ]

        for groq_model in ["llama-4-maverick-17b", "llama3-70b-8192"]:
            try:
                resp = await asyncio.wait_for(
                    groq.chat.completions.create(
                        model=groq_model,
                        messages=text_messages,
                        max_tokens=300,
                        temperature=TEMPERATURE,
                    ),
                    timeout=8.0,
                )
                text = (resp.choices[0].message.content or "").strip()
                if text:
                    return {
                        "response": clean_response(text),
                        "vision_used": False,
                        "detections": [],
                        "needs_recapture": False,
                        "recapture_message": "",
                    }
            except Exception:
                continue

    except Exception as e:
        logger.error("Groq fallback also failed: %s", e)

    return {
        "response": "I'm having trouble right now — could you try asking again?",
        "vision_used": False,
        "detections": [],
        "needs_recapture": False,
        "recapture_message": "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# TEXT-ONLY CHAT — No frame needed (reuses chat_service)
# ─────────────────────────────────────────────────────────────────────────────

async def text_only_chat(
    transcript: str,
    history: list[dict],
    language: str = "en",
) -> dict:
    """
    Standard text-only chat — camera is on but this question doesn't need vision.

    Returns: {"response": str, "vision_used": False}
    """
    lang_info = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES.get("en", {}))
    lang_name = lang_info.get("name", "English")

    try:
        response = await chat_full(
            user_message=transcript,
            history=history,
            intent="question",
            mode="voice",               # voice mode for conversational tone
            target_language=language,
            language_name=lang_name,
        )
        return {
            "response": response,
            "vision_used": False,
            "detections": [],
            "needs_recapture": False,
            "recapture_message": "",
        }
    except Exception as e:
        logger.error("Text-only chat failed: %s", e)
        return {
            "response": "I'm having trouble processing that — could you try again?",
            "vision_used": False,
            "detections": [],
            "needs_recapture": False,
            "recapture_message": "",
        }
