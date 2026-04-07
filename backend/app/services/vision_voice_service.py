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
