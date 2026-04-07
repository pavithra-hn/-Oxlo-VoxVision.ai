"""
language_service.py  (v2)
──────────────────────────
Centralised language detection with two complementary strategies:

  1. Keyword scan — catches "in Kannada", "explain in Tamil", etc.
  2. Script detection — catches pure Indic-script inputs like
     "ಚಹಾ ಮಾಡುವುದು ಹೇಗೆ ವಿವರವಾಗಿ ಹೇಳಿ" (no English keyword present)

Responsibilities:
  • detect_language_from_text()  — returns (lang_code, lang_name)
  • build_native_script_prompt() — legacy helper (still used in some paths)
  • get_tts_config()             — TTS engine + lang code
"""

import re
import logging
from app.config import SUPPORTED_LANGUAGES

logger = logging.getLogger("Oxlo VoxVision.ai.language")

# ── 1. Keyword → language map ─────────────────────────────────────────────────
_LANGUAGE_KEYWORDS: dict[str, str] = {
    # Kannada
    "kannada":  "kn",
    "ಕನ್ನಡ":    "kn",
    # Tamil
    "tamil":    "ta",
    "தமிழ்":    "ta",
    # Telugu
    "telugu":   "te",
    "తెలుగు":   "te",
    # Hindi
    "hindi":    "hi",
    "हिन्दी":   "hi",
    "हिंदी":    "hi",
    # English
    "english":  "en",
    # Others
    "spanish":  "es",
    "french":   "fr",
    "japanese": "ja",
}

_LANG_PATTERN = re.compile(
    r'\b(' + '|'.join(re.escape(k) for k in _LANGUAGE_KEYWORDS) + r')\b',
    re.IGNORECASE | re.UNICODE,
)

# ── 2. Script → language map (Unicode block ranges) ───────────────────────────
# These detect when the entire input is in a native script (no explicit keyword).
_SCRIPT_RANGES: list[tuple[re.Pattern, str]] = [
    # Kannada  U+0C80–U+0CFF
    (re.compile(r'[\u0C80-\u0CFF]'), "kn"),
    # Tamil    U+0B80–U+0BFF
    (re.compile(r'[\u0B80-\u0BFF]'), "ta"),
    # Telugu   U+0C00–U+0C7F
    (re.compile(r'[\u0C00-\u0C7F]'), "te"),
    # Devanagari (Hindi / Marathi) U+0900–U+097F
    (re.compile(r'[\u0900-\u097F]'), "hi"),
    # Bengali  U+0980–U+09FF
    (re.compile(r'[\u0980-\u09FF]'), "bn"),
    # Gujarati U+0A80–U+0AFF
    (re.compile(r'[\u0A80-\u0AFF]'), "gu"),
    # Gurmukhi (Punjabi) U+0A00–U+0A7F
    (re.compile(r'[\u0A00-\u0A7F]'), "pa"),
]

def _detect_script(text: str) -> str | None:
    """
    Score each Indic script by character frequency.
    Returns the lang_code of the dominant script if it covers ≥ 30 % of
    non-whitespace characters, else None.
    """
    if not text:
        return None

    non_ws = len(text.replace(' ', ''))
    if non_ws == 0:
        return None

    scores: dict[str, int] = {}
    for pattern, lang in _SCRIPT_RANGES:
        count = len(pattern.findall(text))
        if count > 0:
            scores[lang] = count

    if not scores:
        return None

    best_lang = max(scores, key=lambda k: scores[k])
    if scores[best_lang] / non_ws >= 0.30:
        return best_lang
    return None


def detect_language_from_text(text: str) -> tuple[str, str]:
    """
    Detect target language from user input text.

    Strategy:
      1. Keyword scan (fastest — handles "in Kannada", "telugu lo", etc.)
      2. Script detection (handles all-Indic inputs with no English keyword)

    Returns (lang_code, lang_name), defaults to ("en", "English").
    """
    if not text:
        return "en", "English"

    # ── Strategy 1: keyword scan ──────────────────────────────────────────────
    match = _LANG_PATTERN.search(text)
    if match:
        keyword   = match.group(1)
        lang_code = _LANGUAGE_KEYWORDS.get(keyword.lower()) or _LANGUAGE_KEYWORDS.get(keyword)
        if lang_code and lang_code in SUPPORTED_LANGUAGES:
            lang_name = SUPPORTED_LANGUAGES[lang_code]["name"]
            logger.info(f"Language detected (keyword): '{keyword}' → {lang_code} ({lang_name})")
            return lang_code, lang_name

    # ── Strategy 2: script detection ─────────────────────────────────────────
    script_lang = _detect_script(text)
    if script_lang and script_lang in SUPPORTED_LANGUAGES:
        lang_name = SUPPORTED_LANGUAGES[script_lang]["name"]
        logger.info(f"Language detected (script): {script_lang} ({lang_name})")
        return script_lang, lang_name

    return "en", "English"


def reconcile_language(
    stt_lang: str | None,
    transcript_text: str,
) -> tuple[str, str]:
    """
    Single source of truth for language detection.

    Cross-references THREE signals to produce one final, reliable language code:
      1. Keyword detection  — explicit user request ("in Kannada", "தமிழ்")
      2. Script detection   — Unicode character frequency analysis
      3. STT engine detect  — language code returned by Sarvam/Whisper audio analysis

    Priority: keyword > script > stt_engine > default "en"

    This resolves the core issue: STT auto-detect says one thing,
    text analysis says another, and the system had no tiebreaker.

    Returns (lang_code, lang_name).
    """
    text = (transcript_text or "").strip()

    # ── Signal 1: Keyword (highest priority — user explicitly asked for a language) ──
    if text:
        match = _LANG_PATTERN.search(text)
        if match:
            keyword   = match.group(1)
            kw_lang   = _LANGUAGE_KEYWORDS.get(keyword.lower()) or _LANGUAGE_KEYWORDS.get(keyword)
            if kw_lang and kw_lang in SUPPORTED_LANGUAGES:
                lang_name = SUPPORTED_LANGUAGES[kw_lang]["name"]
                logger.info(
                    f"Language reconciled (keyword wins): '{keyword}' → {kw_lang} ({lang_name}) "
                    f"[stt_hint={stt_lang}]"
                )
                return kw_lang, lang_name

    # ── Signal 2: Script detection (second priority — actual characters in text) ──
    if text:
        script_lang = _detect_script(text)
        if script_lang and script_lang in SUPPORTED_LANGUAGES:
            lang_name = SUPPORTED_LANGUAGES[script_lang]["name"]
            # If STT agrees, high confidence.  If STT disagrees, script wins
            # because text characters are more reliable than audio-based guesses.
            if stt_lang and stt_lang != script_lang:
                logger.warning(
                    f"Language conflict: STT={stt_lang} vs Script={script_lang}. "
                    f"Script wins (characters are authoritative)."
                )
            else:
                logger.info(
                    f"Language reconciled (script detection): {script_lang} ({lang_name}) "
                    f"[stt_hint={stt_lang}]"
                )
            return script_lang, lang_name

    # ── Signal 3: STT engine detection (third priority — audio-based) ──
    if stt_lang and stt_lang in SUPPORTED_LANGUAGES:
        lang_name = SUPPORTED_LANGUAGES[stt_lang]["name"]
        logger.info(f"Language reconciled (STT engine): {stt_lang} ({lang_name})")
        return stt_lang, lang_name

    # ── Default ──
    return "en", "English"


def build_native_script_prompt(lang_code: str, lang_name: str) -> str:
    """
    Legacy helper — returns a native-script instruction block for the LLM.
    New code should prefer chat_service._build_multilingual_instruction() which
    also handles detail/step-by-step enforcement.
    """
    if lang_code == "en":
        return ""

    lang_info   = SUPPORTED_LANGUAGES.get(lang_code, {})
    script_name = lang_info.get("script", lang_name)

    script_examples = {
        "kn": "ಕನ್ನಡ ಲಿಪಿಯನ್ನು ಬಳಸಿ",
        "ta": "தமிழ் எழுத்துக்களைப் பயன்படுத்தவும்",
        "te": "తెలుగు లిపిని ఉపయోగించండి",
        "hi": "देवनागरी लिपि का प्रयोग करें",
    }
    example = script_examples.get(lang_code, "")

    return (
        f"\n\n🔴 CRITICAL LANGUAGE INSTRUCTION:\n"
        f"The user wants a response in {lang_name}.\n"
        f"You MUST respond ONLY in {lang_name} using {script_name} native script.\n"
        f"{'Example native script: ' + example if example else ''}\n"
        f"STRICTLY FORBIDDEN:\n"
        f"  - English words (unless a proper noun with no {lang_name} equivalent)\n"
        f"  - Romanized/transliterated text\n"
        f"  - Code-switching or mixing languages\n"
        f"REQUIRED:\n"
        f"  - Natural conversational {lang_name} as spoken by a native speaker\n"
        f"  - Correct grammar and vocabulary in {script_name} script\n"
        f"  - Keep response voice-friendly (will be spoken aloud)"
    )


def get_tts_config(lang_code: str) -> dict:
    """Return TTS configuration for a language."""
    lang_info = SUPPORTED_LANGUAGES.get(lang_code, SUPPORTED_LANGUAGES["en"])
    return {
        "engine":       lang_info.get("tts_engine", "kokoro"),
        "gtts_lang":    lang_info.get("gtts_lang", "en"),
        "kokoro_voice": lang_info.get("kokoro_voice", "af_heart"),
        "lang_name":    lang_info.get("name", "English"),
    }
