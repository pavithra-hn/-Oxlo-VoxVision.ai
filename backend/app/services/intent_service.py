import re
import logging
from typing import Optional
from app.services.oxlo_client import oxlo
from app.config import MODELS

logger = logging.getLogger("Oxlo VoxVision.ai.intent")

# ── Fast regex-based intent detection (no LLM call needed) ────────────────────
_question_patterns = [
    r'^\s*(what|who|where|when|why|how|is|are|was|were|do|does|did|can|could|would|should|will|shall|may|might)\b',
    r'\?\s*$',
    r'\b(tell me|explain|describe|define|what\'s|who\'s|how\'s)\b',
]

_command_patterns = [
    r'^\s*(open|close|start|stop|play|pause|set|turn|switch|enable|disable|show|hide|create|delete|send|find|search|go to|navigate)\b',
    r'^\s*(please\s+)?(do|make|get|give|put|take|bring|help|let)\b',
    r'\b(remind me|set a timer|set an alarm|add to|save this)\b',
]

_image_generation_patterns = [
    r'\b(generate|create|make|draw|paint|design|render|produce)\b.{0,20}\b(image|picture|photo|illustration|artwork|art|portrait|poster|wallpaper|icon|logo|graphic)\b',
    r'\b(image|picture|photo|illustration|artwork)\b.{0,20}\b(of|showing|with|depicting|featuring)\b',
    r'^\s*(generate|create|draw|paint|design|render)\b.{0,10}\b(an?|the|me|some)\b',
    r'\b(imagine|visualize|picture this|show me)\b.{0,30}',
]

# ── Explanation / instructional intent patterns ───────────────────────────────
_explanation_patterns = [
    r'\b(explain|describe|tell me about|give me|list|provide)\b.{0,30}\b(ingredients?|steps?|instructions?|recipe|how to|process|method|preparation|procedure|tutorial|guide|details?|materials?|tools?)\b',
    r'\b(ingredients?|steps?|instructions?|recipe|how to|preparation|procedure|tutorial)\b',
    r'\b(and|also|with|plus|along with|as well as)\b.{0,20}\b(explain|describe|list|give|tell|show|provide|include|write)\b',
    r'\b(how to|how do I|how can I)\b.{0,40}\b(make|build|create|prepare|cook|bake|assemble|construct|design)\b',
    r'\b(step.?by.?step|detailed|complete)\b.{0,20}\b(guide|instructions?|explanation|recipe|tutorial|process)\b',
]

_compiled_questions = [re.compile(p, re.IGNORECASE) for p in _question_patterns]
_compiled_commands = [re.compile(p, re.IGNORECASE) for p in _command_patterns]
_compiled_image_gen = [re.compile(p, re.IGNORECASE) for p in _image_generation_patterns]
_compiled_explanation = [re.compile(p, re.IGNORECASE) for p in _explanation_patterns]

# ── Subject extraction patterns ───────────────────────────────────────────────
_subject_extractors = [
    # "image of X and explain..." / "image of X and list..."
    re.compile(r'\b(?:image|picture|photo|illustration|artwork)\s+(?:of|showing|depicting|featuring)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+and\s+(?:explain|describe|list|give|tell|provide|also|with)|$)', re.IGNORECASE),
    # "generate/create X and explain..."
    re.compile(r'\b(?:generate|create|make|draw|paint|design|render)\s+(?:an?\s+)?(?:image|picture|photo)?\s*(?:of\s+)?(?:an?\s+|the\s+)?(.+?)(?:\s+and\s+(?:explain|describe|list|give|tell|provide|also|with)|$)', re.IGNORECASE),
    # Fallback: grab everything after "of" until "and"
    re.compile(r'\bof\s+(?:an?\s+|the\s+)?(.+?)(?:\s+and\s+|$)', re.IGNORECASE),
]


def _has_image_intent(text: str) -> bool:
    """Check if text contains image generation intent."""
    return any(p.search(text) for p in _compiled_image_gen)


def _has_explanation_intent(text: str) -> bool:
    """Check if text contains explanation/instructional intent."""
    return any(p.search(text) for p in _compiled_explanation)


def _extract_image_subject(text: str) -> str:
    """Extract the image subject from a compound prompt."""
    for pattern in _subject_extractors:
        match = pattern.search(text)
        if match:
            subject = match.group(1).strip().rstrip('.,!?')
            # Clean up trailing noise
            subject = re.sub(r'\s+and\s*$', '', subject, flags=re.IGNORECASE).strip()
            if len(subject) > 3:
                return subject
    # Fallback: use the full prompt minus explanation keywords
    cleaned = re.sub(
        r'\b(and\s+)?(explain|describe|list|give|tell|provide|show|include|write)\b.*$',
        '', text, flags=re.IGNORECASE
    ).strip().rstrip('.,!?')
    return cleaned if len(cleaned) > 3 else text.strip()


def detect_intent_fast(text: str) -> dict:
    """
    Fast regex-based intent detection (no API call).
    Returns: { "intent": str, "confidence": float, "method": "regex", ... }
    For compound intents, also includes: "sub_intents", "image_subject"
    """
    if not text.strip():
        return {"intent": "unknown", "confidence": 0.0, "method": "regex"}

    # ── Check for COMPOUND intent first (image + explanation) ─────────────
    has_image = _has_image_intent(text)
    has_explanation = _has_explanation_intent(text)

    if has_image and has_explanation:
        image_subject = _extract_image_subject(text)
        logger.info(f"Compound intent detected: image_subject='{image_subject}'")
        return {
            "intent": "compound",
            "sub_intents": ["image_generation", "explanation"],
            "image_subject": image_subject,
            "confidence": 0.92,
            "method": "regex",
        }

    # ── Single image generation intent ────────────────────────────────────
    if has_image:
        return {"intent": "image_generation", "confidence": 0.90, "method": "regex"}

    # Check question patterns
    for pattern in _compiled_questions:
        if pattern.search(text):
            return {"intent": "question", "confidence": 0.85, "method": "regex"}

    # Check command patterns
    for pattern in _compiled_commands:
        if pattern.search(text):
            return {"intent": "command", "confidence": 0.80, "method": "regex"}

    # Default to conversational
    return {"intent": "conversational", "confidence": 0.70, "method": "regex"}


async def detect_intent_llm(text: str) -> dict:
    """
    LLM-based intent detection for ambiguous cases.
    Returns: { "intent": str, "confidence": float, "method": "llm" }
    """
    try:
        response = await oxlo.chat.completions.create(
            model=MODELS["chat"],
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an intent classifier. Classify the user input into exactly one category. "
                        "Reply with ONLY the category name, nothing else.\n"
                        "Categories: question, command, conversational, compound"
                    ),
                },
                {"role": "user", "content": text},
            ],
            max_tokens=10,
            temperature=0.0,
        )

        intent_raw = (response.choices[0].message.content or "").strip().lower()

        # Normalize the response
        if "compound" in intent_raw:
            intent = "compound"
        elif "question" in intent_raw:
            intent = "question"
        elif "command" in intent_raw:
            intent = "command"
        else:
            intent = "conversational"

        return {"intent": intent, "confidence": 0.90, "method": "llm"}

    except Exception as e:
        logger.warning(f"LLM intent detection failed, falling back to regex: {e}")
        return detect_intent_fast(text)


def detect_intent(text: str, use_llm: bool = False) -> dict:
    """
    Synchronous wrapper — uses fast regex by default.
    Set use_llm=True for higher accuracy on ambiguous inputs.
    """
    return detect_intent_fast(text)
