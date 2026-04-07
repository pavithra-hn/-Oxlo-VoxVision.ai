"""
preprocessing_service.py  (v2)
───────────────────────────────
Handles transcript cleaning and intent enrichment.

Key changes vs v1:
  • Indic-script text is NOT aggressively cleaned (no filler stripping on native script)
  • Intent enrichment: adds a "provide detailed step-by-step explanation" instruction
    when the user explicitly asks for detail/steps (in any supported language)
  • Minimum word threshold lowered for Indic (syllabic scripts have fewer words)
"""

import re
import logging

logger = logging.getLogger("Oxlo VoxVision.ai.preprocess")

# ── Filler words to strip — English only ────────────────────────────────────
# We intentionally do NOT strip these from Indic-script text because many
# "filler" patterns in Latin script are content words in native scripts.
FILLERS = {
    "um", "uh", "uhh", "umm", "hmm", "hm", "ah", "ahh", "er", "err",
    "like", "you know", "i mean", "sort of", "kind of", "basically",
    "actually", "literally", "right", "okay so", "so like", "well like",
}

_filler_pattern = re.compile(
    r'\b(' + '|'.join(re.escape(f) for f in sorted(FILLERS, key=len, reverse=True)) + r')\b',
    re.IGNORECASE,
)

_repeated_word  = re.compile(r'\b(\w+)(\s+\1)+\b', re.IGNORECASE)
_multi_space    = re.compile(r'\s{2,}')
_multi_punct    = re.compile(r'([.!?,])\1+')
_leading_comma  = re.compile(r'^\s*[,;]\s*')

# ── Detect whether text is primarily Indic script ───────────────────────────
# Unicode ranges: Devanagari (hi), Kannada, Tamil, Telugu, Bengali, Gujarati…
_INDIC_SCRIPT_RE = re.compile(
    r'[\u0900-\u097F'   # Devanagari (Hindi)
    r'\u0C80-\u0CFF'   # Kannada
    r'\u0B80-\u0BFF'   # Tamil
    r'\u0C00-\u0C7F'   # Telugu
    r'\u0980-\u09FF'   # Bengali
    r'\u0A80-\u0AFF'   # Gujarati
    r'\u0A00-\u0A7F'   # Gurmukhi (Punjabi)
    r']'
)

def _is_indic(text: str) -> bool:
    """Return True when the majority of non-space characters are Indic script."""
    indic_chars = len(_INDIC_SCRIPT_RE.findall(text))
    total_chars = len(text.replace(' ', ''))
    return total_chars > 0 and (indic_chars / total_chars) > 0.4


# ── Intent enrichment keywords (across all supported languages) ─────────────
# These signals tell us the user wants a DETAILED, STEP-BY-STEP response.
_DETAIL_SIGNALS = [
    # English
    "detail", "in detail", "step by step", "explain", "how to", "procedure",
    "steps", "detailed", "thoroughly",
    # Kannada
    "ವಿವರ", "ವಿವರವಾಗಿ", "ಹಂತ", "ಹಂತ-ಹಂತ", "ಹೇಗೆ", "ವಿವರಿಸಿ",
    # Tamil
    "விவரம்", "படிப்படியாக", "விளக்கம்", "எப்படி",
    # Telugu
    "వివరంగా", "దశలవారీగా", "వివరణ", "ఎలా",
    # Hindi
    "विस्तार", "विस्तार से", "चरण", "कैसे", "बताइए",
]

_DETAIL_RE = re.compile(
    r'(' + '|'.join(re.escape(s) for s in sorted(_DETAIL_SIGNALS, key=len, reverse=True)) + r')',
    re.IGNORECASE | re.UNICODE,
)


def _wants_detail(text: str) -> bool:
    """Return True if the user's text contains a detail/step-by-step signal."""
    return bool(_DETAIL_RE.search(text))


def clean_transcript(raw: str) -> str:
    """
    Clean raw ASR transcript.

    For INDIC text:
      - Skip English filler stripping (would damage native script)
      - Only normalize whitespace and punctuation
    For ENGLISH text:
      - Full filler removal, stutter deduplication, whitespace normalization
    Both:
      - Capitalize first character
      - Ensure trailing punctuation
    """
    if not raw or not raw.strip():
        return ""

    text = raw.strip()

    if _is_indic(text):
        # Light-touch clean for Indic — preserve all words
        text = _multi_space.sub(' ', text).strip()
        text = _multi_punct.sub(r'\1', text)
    else:
        # Full clean for English / Romanized text
        text = _filler_pattern.sub('', text)
        text = _repeated_word.sub(r'\1', text)
        text = _leading_comma.sub('', text)
        text = _multi_space.sub(' ', text).strip()
        text = _multi_punct.sub(r'\1', text)
        # Remove trailing single-word fragments after comma
        text = re.sub(r',\s*\w{1,2}\s*$', '', text)

    # Capitalize first letter
    if text:
        text = text[0].upper() + text[1:]

    # Ensure ends with punctuation
    if text and text[-1] not in '.!?।':
        text = text + '.'

    return text.strip()


def enrich_intent(cleaned_text: str, language_code: str = "en") -> str:
    """
    Intent Preservation Layer.

    If the user's request signals a desire for a detailed/step-by-step response,
    append an explicit instruction suffix so the LLM receives an unambiguous signal.

    The suffix is injected as a clarifying clause in the same language as the user.

    Returns the enriched text (or the original if no enrichment needed).
    """
    if not cleaned_text or not cleaned_text.strip():
        return cleaned_text

    if not _wants_detail(cleaned_text):
        return cleaned_text

    # Language-native enrichment suffixes
    ENRICHMENT: dict[str, str] = {
        "kn": " — ದಯವಿಟ್ಟು ಹಂತ-ಹಂತವಾಗಿ ವಿವರವಾದ ವಿವರಣೆ ನೀಡಿ.",
        "ta": " — தயவுசெய்து படிப்படியான விரிவான விளக்கம் தருக.",
        "te": " — దయచేసి దశలవారీగా వివరమైన వివరణ ఇవ్వండి.",
        "hi": " — कृपया चरण-दर-चरण विस्तृत विवरण दें।",
        "en": " Please provide a detailed, step-by-step explanation.",
    }
    suffix = ENRICHMENT.get(language_code, ENRICHMENT["en"])

    # Only append if not already present
    if suffix.strip().lower() not in cleaned_text.lower():
        # Remove trailing punctuation before appending
        enriched = cleaned_text.rstrip('.!?।').rstrip() + suffix
        logger.info(f"Intent enriched: '{enriched[:120]}'")
        return enriched

    return cleaned_text


def _repair_trailing_fragment(text: str) -> str:
    """
    Strip trailing word fragments that indicate an abrupt audio cutoff.

    Heuristic: If the last token is a single character (not a valid word-ending
    in any language) AND the text has more tokens, drop it.
    Also strip orphan punctuation at the end.
    """
    if not text:
        return text
    # Strip trailing orphan punctuation (but keep Indic danda ।)
    cleaned = re.sub(r'[\s,;:\-]+$', '', text)
    words = cleaned.split()
    if len(words) >= 2:
        last = words[-1].rstrip('.!?।')
        # Single Latin letter that isn't "I" or "a" → likely a fragment
        if len(last) == 1 and last.isascii() and last.lower() not in ('i', 'a'):
            cleaned = ' '.join(words[:-1])
            # Re-add sentence-ending punctuation
            if cleaned and cleaned[-1] not in '.!?।':
                cleaned += '.'
    return cleaned


def is_valid_input(text: str) -> tuple[bool, str]:
    """
    Validate cleaned transcript before sending to LLM.
    Returns (is_valid, reason).

    Rejection reasons:
      - "empty"              — no text at all
      - "too_short"          — fewer than minimum words for the language
      - "noise"              — pure noise / too few unique characters
      - "gibberish"          — too many non-letter symbols (>50%)
      - "unknown_language"   — can't determine what language this is

    For Indic text we apply a lower word-count threshold because a single
    Kannada/Tamil word can encode a full clause.
    """
    if not text or not text.strip():
        return False, "empty"

    stripped = text.strip().rstrip('.!?।')
    words = stripped.split()
    is_indic = _is_indic(stripped)

    # ── Check 1: Minimum word count ──────────────────────────────────────
    # Indic: 1 word (syllabic scripts are dense)
    # English: 3 words (previously 2, now stricter)
    min_words = 1 if is_indic else 3
    if len(words) < min_words:
        return False, "too_short"

    # ── Check 2: All-noise guard — very few unique characters ────────────
    unique_chars = set(stripped.lower().replace(' ', ''))
    if len(unique_chars) < 2:
        return False, "noise"

    # ── Check 3: Gibberish — too many non-letter symbols ─────────────────
    # If >50% of non-space characters are symbols/digits, it's garbage
    non_space = stripped.replace(' ', '')
    if non_space:
        letter_count = sum(1 for c in non_space if c.isalpha())
        if letter_count / len(non_space) < 0.50:
            return False, "gibberish"

    # ── Check 4: Consonant salad — all single-char words ─────────────────
    # "b k q r t" is not a valid sentence in any language
    if not is_indic and len(words) >= 3:
        single_char_words = sum(1 for w in words if len(w.rstrip('.!?,')) == 1)
        if single_char_words / len(words) > 0.6:
            return False, "gibberish"

    return True, "ok"


def extract_confidence_label(confidence: float) -> str:
    """Map ASR confidence score to human-readable label."""
    if confidence >= 0.85:
        return "high"
    elif confidence >= 0.60:
        return "medium"
    elif confidence >= 0.30:
        return "low"
    else:
        return "very_low"
