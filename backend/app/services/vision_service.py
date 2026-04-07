"""
vision_service.py

Optimized pipeline with full language support:
- Detection + narration run IN PARALLEL via asyncio.gather
- Language-aware system prompts: LLM responds in selected language (Kannada/Tamil/etc.)
- oxlo_fast (max_retries=0) fails fast on 429 — no SDK retry delays
- Module-level rate-limit tracker skips Kimi for 90s after a 429
- Groq text fallback fires immediately when Oxlo is throttled
- Target latency: 8-15s (was 60s)
"""

import asyncio
import json
import logging
import time
from typing import List

from openai.types.chat import ChatCompletionContentPartParam

from app.services.oxlo_client import oxlo_fast, groq
from app.services.yolo_service import detect_objects
from app.config import MODELS, TEMPERATURE, SUPPORTED_LANGUAGES
from app.models.schemas import DetectionBox

logger = logging.getLogger("Oxlo VoxVision.ai.vision")

# ── Rate-limit tracker ────────────────────────────────────────────────────────
_SKIP_SECS = 90.0
_kimi_blocked_until: float = 0.0


def _kimi_is_blocked() -> bool:
    return time.monotonic() < _kimi_blocked_until


def _block_kimi() -> None:
    global _kimi_blocked_until
    _kimi_blocked_until = time.monotonic() + _SKIP_SECS
    logger.warning("Kimi rate-limited — skipping for %.0fs", _SKIP_SECS)


# ── Narration system prompts ─────────────────────────────────────────────────

VISION_SYSTEM_EN = (
    "You are Oxlo VoxVision.ai Vision — an AI with live eyes through the user's webcam. "
    "Your PRIMARY job is to IDENTIFY and NAME every specific object you can see — including brand names "
    "(e.g. Orbit, Pepsi, Samsung, MacBook), product types, clothing, food, furniture, people, text on labels, everything. "
    "ALWAYS start by listing what you see: 'I can see [object1], [object2], [object3]...', then describe the overall scene. "
    "Be specific: say 'Orbit chewing gum packet' not 'packet'. Say 'blue plastic bottle' not 'bottle'. "
    "Mention what is in the foreground, what is in the background. "
    "Keep it to 3-4 sentences. You are speaking out loud like a friend narrating what they see."
)


def _build_vision_system(language: str) -> str:
    """Return a language-enforcing system prompt for vision narration."""
    if language == "en":
        return VISION_SYSTEM_EN

    lang_info = SUPPORTED_LANGUAGES.get(language, {})
    lang_name = lang_info.get("name", language)
    script = lang_info.get("script", "native script")

    return (
        f"You are Oxlo VoxVision.ai Vision — an AI with live eyes through the user's webcam. "
        f"CRITICAL LANGUAGE RULE: You MUST respond ONLY in {lang_name} using {lang_name} native script ({script}). "
        f"DO NOT use English, Latin transliteration, or any other language. "
        f"Write ONLY in authentic {lang_name} unicode characters. "
        f"Your PRIMARY job is to IDENTIFY and NAME every specific object you can see — include brand names, "
        f"product types, clothing, food, and background items. "
        f"ALWAYS start by naming what you see, then describe the scene. "
        f"Keep it to 3-4 sentences. You are speaking out loud."
    )


def _build_groq_vision_system(language: str, label_hint: str) -> str:
    """Groq fallback system prompt (text-only, no image)."""
    lang_info = SUPPORTED_LANGUAGES.get(language, {})
    lang_name = lang_info.get("name", "English")
    script = lang_info.get("script", "Latin")

    base = (
        f"You are a friendly AI assistant describing a webcam scene. "
        f"Objects detected in the frame: {label_hint or 'unknown objects in a room'}. "
        f"Describe the scene based on these detected objects. Name each object specifically. "
        f"Say what is in the foreground and what might be in the background. "
        f"Be specific — 3-4 sentences."
    )

    if language != "en":
        base = (
            f"CRITICAL: Respond ONLY in {lang_name} using native {script} script. "
            f"DO NOT use English or transliteration. " + base
        )

    return base


# ── Detection pipeline ────────────────────────────────────────────────────────

KIMI_DETECT_PROMPT = (
    "Look at this image and identify all visible objects.\n"
    "Return ONLY a JSON array. Each item must have:\n"
    '- "label": short name of the object (in English, for standardization)\n'
    '- "confidence": your confidence 0.0 to 1.0\n\n'
    'Example: [{"label": "coffee mug", "confidence": 0.95}]\n'
    "Return ONLY the JSON array, nothing else."
)


def _is_rate_limit(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "too many" in msg or "rate" in msg


def _parse_detections(raw: str) -> List[DetectionBox]:
    text = raw.strip()
    if text.startswith("```"):
        text = "\n".join(l for l in text.split("\n") if not l.strip().startswith("```")).strip()
    try:
        start, end = text.find("["), text.rfind("]") + 1
        if 0 <= start < end:
            items = json.loads(text[start:end])
            return [
                DetectionBox(
                    label=str(item.get("label", "object")),
                    confidence=round(float(item.get("confidence", 0.8)), 2),
                    bbox=[0.0, 0.0, 0.0, 0.0],
                )
                for item in items
                if isinstance(item, dict) and "label" in item
            ]
    except Exception as e:
        logger.debug("Detection parse error: %s", e)
    return []


async def _kimi_detect(image_base64: str) -> List[DetectionBox]:
    """Fast Kimi detection — 8s hard timeout, skipped if rate-limited."""
    if _kimi_is_blocked():
        logger.info("Kimi detection skipped (rate-limited)")
        return []

    content: List[ChatCompletionContentPartParam] = [
        {"type": "text", "text": KIMI_DETECT_PROMPT},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
    ]
    try:
        logger.info("Kimi detection — model=%s", MODELS["vision"])
        resp = await asyncio.wait_for(
            oxlo_fast.chat.completions.create(
                model=MODELS["vision"],
                messages=[{"role": "user", "content": content}],
                max_tokens=250,
                temperature=0.2,
            ),
            timeout=8.0,
        )
        boxes = _parse_detections(resp.choices[0].message.content or "")
        if boxes:
            logger.info("Kimi detected %d objects", len(boxes))
        return boxes
    except asyncio.TimeoutError:
        logger.warning("Kimi detection timed out")
        return []
    except Exception as e:
        if _is_rate_limit(e):
            _block_kimi()
        else:
            logger.warning("Kimi detection error: %s", e)
        return []


async def _yolo_detect(image_base64: str) -> List[DetectionBox]:
    try:
        boxes = await asyncio.wait_for(detect_objects(image_base64), timeout=10.0)
        return boxes or []
    except asyncio.TimeoutError:
        logger.warning("YOLO detection timed out")
        return []
    except Exception as e:
        logger.warning("YOLO detection error: %s", e)
        return []


async def _detect(image_base64: str) -> List[DetectionBox]:
    """Kimi first (8s), YOLO fallback (10s)."""
    boxes = await _kimi_detect(image_base64)
    if boxes:
        return boxes
    logger.info("Kimi returned empty — trying YOLO")
    return await _yolo_detect(image_base64)


# ── Narration pipeline ────────────────────────────────────────────────────────

async def _narrate_oxlo(messages: list) -> str:
    """Try vision-capable Oxlo models. Returns '' on failure."""
    models = [MODELS["vision"]] + list(MODELS.get("vision_fallback", []))

    for model in models:
        if model == MODELS["vision"] and _kimi_is_blocked():
            logger.info("Narration: skipping Kimi (rate-limited)")
            continue
        try:
            logger.info("Vision narration — model=%s", model)
            resp = await asyncio.wait_for(
                oxlo_fast.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=250,
                    temperature=TEMPERATURE,
                ),
                timeout=15.0,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                logger.info("Vision narration success — model=%s", model)
                return text
        except asyncio.TimeoutError:
            logger.warning("Narration timed out — model=%s", model)
        except Exception as e:
            if _is_rate_limit(e):
                _block_kimi()
            logger.warning("Narration error — model=%s: %s", model, e)

    return ""


async def _narrate_groq(messages: list, label_hint: str, language: str) -> str:
    """Groq text-only fallback — strips image parts, uses label context."""
    text_messages = []
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = [p["text"] for p in content if p.get("type") == "text"]
            if text_parts:
                text_messages.append({"role": m["role"], "content": " ".join(text_parts)})
        elif isinstance(content, str):
            text_messages.append(m)

    if not text_messages:
        system = _build_groq_vision_system(language, label_hint)
        text_messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Describe a live webcam scene. {label_hint}"},
        ]

    for model in ["llama-4-maverick-17b", "llama3-70b-8192"]:
        try:
            logger.info("Groq narration fallback — model=%s lang=%s", model, language)
            resp = await asyncio.wait_for(
                groq.chat.completions.create(
                    model=model,
                    messages=text_messages,
                    max_tokens=250,
                    temperature=TEMPERATURE,
                ),
                timeout=8.0,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                logger.info("Groq narration success — model=%s", model)
                return text
        except asyncio.TimeoutError:
            logger.warning("Groq narration timed out — model=%s", model)
        except Exception as e:
            logger.warning("Groq narration error — model=%s: %s", model, e)

    return "I can see your scene but I'm having trouble describing it right now."


# ── Main entry point ──────────────────────────────────────────────────────────

async def analyze_frame(
    image_base64: str,
    user_prompt: str | None,
    history: List[dict],
    language: str = "en",
) -> tuple[str, List[DetectionBox]]:
    """
    Analyze a webcam frame and narrate in the specified language.

    Language routing:
    - 'en' → English narration (default Oxlo Kimi/fallback)
    - 'kn'/'ta'/'te'/'hi' → LLM instructed to respond in native script

    Detection + narration run concurrently (asyncio.gather).
    If Oxlo is rate-limited, Groq fires for text narration in the correct language.
    """
    prompt = user_prompt or (
        "Look at this webcam frame carefully. "
        "Name EVERY specific object you can see — include brand names on any products "
        "(like 'Orbit gum packet', 'Pepsi bottle', 'Samsung phone', etc.). "
        "Then describe the full scene: foreground objects, background, lighting, and what the person is doing."
    )
    lang_info = SUPPORTED_LANGUAGES.get(language, SUPPORTED_LANGUAGES["en"])
    lang_name = lang_info.get("name", "English")

    logger.info("Vision analyze — lang=%s (%s)", language, lang_name)

    # ── Build system prompt + narration messages ──────────────────────────────
    system_prompt = _build_vision_system(language)
    content: List[ChatCompletionContentPartParam] = [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}},
    ]
    narration_messages = [
        {"role": "system", "content": system_prompt},
        *[{"role": m["role"], "content": m["content"]} for m in history],
        {"role": "user", "content": content},
    ]


    # ── Launch detection + Oxlo narration concurrently ────────────────────────
    detect_task = asyncio.create_task(_detect(image_base64))
    narrate_task = asyncio.create_task(_narrate_oxlo(narration_messages))

    oxlo_text, detections = await asyncio.gather(narrate_task, detect_task)

    if oxlo_text:
        return oxlo_text, detections

    # ── Oxlo failed — Groq fallback in correct language ───────────────────────
    logger.info("Oxlo narration failed — Groq fallback in lang=%s", language)
    labels = [d.label for d in detections if d.confidence >= 0.45]
    label_hint = f"Objects: {', '.join(labels)}." if labels else ""

    groq_text = await _narrate_groq(narration_messages, label_hint, language)
    return groq_text, detections
