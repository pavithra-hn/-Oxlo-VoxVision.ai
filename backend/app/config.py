import os
from dotenv import load_dotenv

load_dotenv()

# ── Oxlo.ai ──────────────────────────────────────────────────────────────────
OXLO_API_KEY  = os.getenv("OXLO_API_KEY", "")
OXLO_BASE_URL = "https://api.oxlo.ai/v1"

# ── Groq (Whisper fallback STT) ───────────────────────────────────────────────
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# ── Sarvam AI (primary STT — Saaras v3, Indian-language optimised) ────────────
SARVAM_API_KEY  = os.getenv("SARVAM_API_KEY", "")
SARVAM_BASE_URL = "https://api.sarvam.ai"

# Priority order for STT engines (first = primary)
# "sarvam" will be tried first; on failure "groq" (Whisper) is the fallback
STT_ENGINE_PRIORITY = ["sarvam", "groq"]

# ── Model IDs ─────────────────────────────────────────────────────────────────
MODELS = {
    # Primary LLM — Premium tier (Claude Sonnet level, strong multilingual)
    "chat":            "kimi-k2.5",
    # Fallback chain if primary hits 403
    "chat_fallback":   ["deepseek-r1-70b", "llama-4-maverick-17b", "ministral-14b"],
    # Fast voice LLM — Qwen 3 32B is MUCH better for Indian languages than Llama 8B
    "chat_voice":      "qwen-3-32b",
    # Vision LLM (Kimi supports images natively)
    "vision":          "kimi-k2.5",
    "vision_fallback": ["llama-4-maverick-17b", "ministral-14b"],
    # Audio — STT: Sarvam Saaras v3 (primary, Indian-language optimised)
    "stt":             "saaras:v3",                 # Sarvam primary
    "stt_groq":        "whisper-large-v3-turbo",    # Groq Whisper fallback
    "stt_oxlo":        "whisper-large-v3",           # Oxlo Whisper fallback
    # TTS — Kokoro for English; Indian langs handled by gTTS in tts_service
    "tts":             "kokoro-82m",
    # Computer vision
    "detect":          "yolo-v11",
    # Image generation
    "image":           "oxlo-image-pro",            # Premium image gen
    "image_fast":      "flux.1-schnell",            # Pro fast fallback
}

# ── App settings ──────────────────────────────────────────────────────────────
MAX_TOKENS_CHAT     = 4096          # Supports full rich responses
MAX_TOKENS_VOICE    = 1200          # Must be high enough for full recipe (ingredients + 5+ steps)
MAX_TOKENS_VISION   = 1024
MAX_TOKENS_COMPOUND = 8192
IMAGE_DEFAULT_SIZE  = "1024x1024"
STT_LANGUAGE        = None          # None = auto-detect (all Indian languages)
VISION_INTERVAL_S   = 8

# ── LLM Sampling Parameters ───────────────────────────────────────────────────
# Anti-hallucination settings (lower = more deterministic = fewer hallucinations)
TEMPERATURE          = 0.35         # General chat — low enough to stay factual
TEMPERATURE_VOICE    = 0.20         # Voice/factual: very low → no hallucination
TEMPERATURE_COMPOUND = 0.50         # Compound (image + text): balanced creativity
TOP_P                = 0.85         # General: tighter nucleus (was 0.95)
TOP_P_VOICE          = 0.80         # Voice/factual: most focused

# ── Response Validation Thresholds ────────────────────────────────────────────
# Used by chat_service post-generation check to reject and retry bad outputs.
MIN_RESPONSE_CHARS_VOICE   = 80     # < 80 chars for a voice answer is always too short
MIN_RESPONSE_CHARS_DETAIL  = 300    # detail/how-to must be at least 300 chars
MAX_RETRY_ATTEMPTS         = 2      # two automatic regeneration attempts for incomplete output

# ── Multi-Language Support ────────────────────────────────────────────────────
# tts_engine: "kokoro" = Oxlo Kokoro | "gtts" = Google Translate TTS (free, Indic support)
SUPPORTED_LANGUAGES = {
    "en": {
        "name": "English",
        "stt_code": "en",
        "sarvam_code": "en-IN",          # Sarvam BCP-47
        "kokoro_voice": "af_heart",      # Kokoro English female voice
        "gtts_lang": "en",
        "tts_engine": "kokoro",          # English → Kokoro (high quality)
        "script": "Latin",
    },
    "hi": {
        "name": "Hindi",
        "stt_code": "hi",
        "sarvam_code": "hi-IN",          # Sarvam BCP-47
        "kokoro_voice": "af_heart",
        "gtts_lang": "hi",
        "tts_engine": "gtts",            # Hindi → gTTS (native Devanagari support)
        "script": "Devanagari",
    },
    "kn": {
        "name": "Kannada",
        "stt_code": "kn",
        "sarvam_code": "kn-IN",          # Sarvam BCP-47
        "kokoro_voice": "af_heart",
        "gtts_lang": "kn",
        "tts_engine": "gtts",            # Kannada → gTTS (native Kannada script)
        "script": "Kannada",
    },
    "ta": {
        "name": "Tamil",
        "stt_code": "ta",
        "sarvam_code": "ta-IN",          # Sarvam BCP-47
        "kokoro_voice": "af_heart",
        "gtts_lang": "ta",
        "tts_engine": "gtts",            # Tamil → gTTS (native Tamil script)
        "script": "Tamil",
    },
    "te": {
        "name": "Telugu",
        "stt_code": "te",
        "sarvam_code": "te-IN",          # Sarvam BCP-47
        "kokoro_voice": "af_heart",
        "gtts_lang": "te",
        "tts_engine": "gtts",            # Telugu → gTTS (native Telugu script)
        "script": "Telugu",
    },
    "es": {
        "name": "Spanish",
        "stt_code": "es",
        "sarvam_code": None,             # Not natively supported by Sarvam
        "kokoro_voice": "af_heart",
        "gtts_lang": "es",
        "tts_engine": "kokoro",
        "script": "Latin",
    },
    "fr": {
        "name": "French",
        "stt_code": "fr",
        "sarvam_code": None,             # Not natively supported by Sarvam
        "kokoro_voice": "af_heart",
        "gtts_lang": "fr",
        "tts_engine": "kokoro",
        "script": "Latin",
    },
    "ja": {
        "name": "Japanese",
        "stt_code": "ja",
        "sarvam_code": None,             # Not natively supported by Sarvam
        "kokoro_voice": "af_heart",
        "gtts_lang": "ja",
        "tts_engine": "gtts",
        "script": "Japanese",
    },
}
