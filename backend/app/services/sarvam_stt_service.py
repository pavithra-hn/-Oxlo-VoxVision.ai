"""
sarvam_stt_service.py
─────────────────────
Primary Speech-to-Text engine: Sarvam AI — Saaras v3.

Saaras v3 is optimised for all 22 scheduled Indian languages plus English,
supports code-mixed speech, and auto-detects language when no code is given.

Endpoint : POST https://api.sarvam.ai/speech-to-text
Auth     : api-subscription-key header (NOT Bearer)
Docs     : https://docs.sarvam.ai

Modes available (we default to "transcribe"):
  • transcribe — standard transcription in the original language
  • codemix    — ideal for Hindi-English / Tanglish / Kanglish mixed speech
  • verbatim   — exact word-for-word including filler words
  • translit   — Romanised Latin output
  • translate  — translates audio into English

Return format mirrors whisper_service.transcribe() for drop-in compatibility:
  {
      "text":          str,    # transcribed text
      "confidence":    float,  # 0.0–1.0 estimated confidence
      "duration_hint": float,  # rough duration in seconds
      "language":      str,    # ISO-639-1 code ("hi", "kn", etc.)
      "engine":        str,    # "sarvam"
  }
"""

import asyncio
import logging
import httpx
from app.config import SARVAM_API_KEY, SARVAM_BASE_URL, SUPPORTED_LANGUAGES

logger = logging.getLogger("Oxlo VoxVision.ai.sarvam_stt")

SARVAM_STT_ENDPOINT = f"{SARVAM_BASE_URL}/speech-to-text"

MAX_RETRIES   = 2
RETRY_DELAYS  = [0.5, 1.5]
TIMEOUT_SEC   = 20.0          # Sarvam is slightly slower than Groq; give it time

# Map the project's ISO-639-1 codes → Sarvam BCP-47 codes
# (pulled from SUPPORTED_LANGUAGES config).  Falls back to None = auto-detect.
def _sarvam_lang_code(language: str | None) -> str | None:
    """Return BCP-47 code for Sarvam, or None to trigger auto-detection."""
    if not language:
        return None
    lang_cfg = SUPPORTED_LANGUAGES.get(language, {})
    return lang_cfg.get("sarvam_code")   # may be None for unsupported langs


# Reverse-map Sarvam language codes back to our ISO-639-1 scheme
_SARVAM_TO_ISO: dict[str, str] = {
    cfg.get("sarvam_code"): code
    for code, cfg in SUPPORTED_LANGUAGES.items()
    if cfg.get("sarvam_code")
}
# e.g. {"hi-IN": "hi", "kn-IN": "kn", ...}


def _iso_from_sarvam(sarvam_code: str | None, fallback: str = "en") -> str:
    if not sarvam_code:
        return fallback
    # Strip region suffix if needed ("hi-IN" → "hi")
    return _SARVAM_TO_ISO.get(sarvam_code, sarvam_code.split("-")[0])


def _estimate_confidence(text: str, duration_hint: float) -> float:
    """Very basic heuristic when no score is returned by the API."""
    if not text.strip():
        return 0.0
    words = text.split()
    wc = len(words)
    if duration_hint > 3.0 and wc < 3:
        return 0.30
    if duration_hint > 0:
        wps = wc / duration_hint
        if wps < 0.5:
            return 0.40
        if wps > 8.0:
            return 0.50
    if wc >= 5:
        return 0.85
    if wc >= 3:
        return 0.75
    return 0.60


async def transcribe(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str | None = None,
    mode: str = "transcribe",
) -> dict:
    """
    Transcribe audio using Sarvam AI Saaras v3.

    Parameters
    ----------
    audio_bytes : bytes   — raw audio data from the browser
    mime_type   : str     — MIME type (e.g. "audio/webm", "audio/wav")
    language    : str     — ISO-639-1 language hint (e.g. "hi", "kn").
                            Pass None for auto-detection (best for multilingual inputs).
    mode        : str     — Sarvam transcription mode (default "transcribe").
                            Use "codemix" for code-switched Indian-language input.

    Returns
    -------
    dict with keys: text, confidence, duration_hint, language, engine
    """
    if not SARVAM_API_KEY:
        raise ValueError("SARVAM_API_KEY is not set — cannot use Sarvam STT")

    # Map MIME type to a file extension Sarvam accepts
    ext_map = {
        "audio/webm": ".webm",
        "audio/webm;codecs=opus": ".webm",
        "audio/ogg": ".ogg",
        "audio/ogg;codecs=opus": ".ogg",
        "audio/wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
    }
    ext = ext_map.get(mime_type.split(";")[0].strip(), ".webm")
    filename = f"recording{ext}"

    # Derive Sarvam BCP-47 code (None = auto)
    sarvam_code = _sarvam_lang_code(language)

    # Estimate duration
    estimated_duration = len(audio_bytes) / 16_000.0

    headers = {
        "api-subscription-key": SARVAM_API_KEY,
    }

    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            # Build multipart form fields
            form_data: dict = {
                "model": "saaras:v3",
                "mode":  mode,
            }
            # Include language_code only when we have one (auto-detect otherwise)
            if sarvam_code:
                form_data["language_code"] = sarvam_code

            async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
                response = await client.post(
                    SARVAM_STT_ENDPOINT,
                    headers=headers,
                    files={
                        "file": (filename, audio_bytes, mime_type.split(";")[0]),
                    },
                    data=form_data,
                )

            if response.status_code == 200:
                result = response.json()

                # Sarvam response: {"transcript": "...", "language_code": "hi-IN", ...}
                text = result.get("transcript", "").strip()

                # Detected language
                raw_lang = result.get("language_code", sarvam_code)
                detected_iso = _iso_from_sarvam(raw_lang, fallback=language or "en")

                # Confidence: Sarvam may return language_probability (0–1)
                lang_prob = result.get("language_probability")
                confidence = float(lang_prob) if lang_prob is not None else _estimate_confidence(text, estimated_duration)
                confidence = round(max(0.0, min(1.0, confidence)), 2)

                elapsed = response.elapsed.total_seconds() if response.elapsed else 0
                logger.info(
                    f"Sarvam Saaras v3 [{detected_iso}|{raw_lang}] mode={mode}: "
                    f"'{text[:80]}' (conf={confidence}, {elapsed:.2f}s)"
                )

                return {
                    "text":          text,
                    "confidence":    confidence,
                    "duration_hint": round(estimated_duration, 1),
                    "language":      detected_iso,
                    "engine":        "sarvam",
                }

            elif response.status_code == 429:
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                logger.warning(
                    f"Sarvam rate-limited (attempt {attempt + 1}/{MAX_RETRIES}), "
                    f"waiting {delay}s…"
                )
                await asyncio.sleep(delay)
                last_error = Exception(f"Sarvam rate-limited: 429")

            elif response.status_code >= 500:
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                detail = response.text[:200]
                logger.warning(
                    f"Sarvam server error {response.status_code} "
                    f"(attempt {attempt + 1}): {detail}"
                )
                await asyncio.sleep(delay)
                last_error = Exception(
                    f"Sarvam server error {response.status_code}: {detail}"
                )

            else:
                detail = response.text[:300]
                logger.error(
                    f"Sarvam transcription failed: {response.status_code} — {detail}"
                )
                raise Exception(
                    f"Sarvam transcription failed: HTTP {response.status_code} — {detail}"
                )

        except httpx.TimeoutException:
            delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
            logger.warning(
                f"Sarvam timeout (attempt {attempt + 1}/{MAX_RETRIES}), "
                f"retrying in {delay}s…"
            )
            await asyncio.sleep(delay)
            last_error = Exception("Sarvam STT timed out")

        except Exception as exc:
            # Only re-raise non-retryable errors immediately
            if any(k in str(exc) for k in ("rate-limited", "server error", "timed out")):
                continue
            logger.error(f"Sarvam unexpected error: {type(exc).__name__}: {exc}")
            raise

    raise last_error or Exception("Sarvam STT failed after all retries")
