import asyncio
import logging
import httpx
from app.config import MODELS, STT_LANGUAGE, GROQ_API_KEY, GROQ_BASE_URL, SUPPORTED_LANGUAGES

logger = logging.getLogger("Oxlo VoxVision.ai.whisper")

MAX_RETRIES = 2
RETRY_DELAYS = [0.5, 1.5]

# Map mime types to proper file extensions
EXT_MAP = {
    "audio/webm": ".webm",
    "audio/webm;codecs=opus": ".webm",
    "audio/ogg": ".ogg",
    "audio/ogg;codecs=opus": ".ogg",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
}


async def transcribe(audio_bytes: bytes, mime_type: str = "audio/webm", language: str | None = None) -> dict:
    """
    Transcribe audio bytes using Whisper via Groq (ultra-fast LPU inference).
    Supports multi-language via the `language` parameter.

    Returns dict: {
        "text": str,
        "confidence": float,   # 0.0–1.0 estimated confidence
        "duration_hint": float # rough audio duration in seconds
        "language": str        # language code used
    }
    """
    ext = EXT_MAP.get(mime_type, ".webm")
    filename = f"recording{ext}"

    # Resolve language: explicit param > config default > auto-detect
    lang = language or STT_LANGUAGE
    if lang and lang not in SUPPORTED_LANGUAGES:
        logger.warning(f"Unsupported language '{lang}', falling back to 'en'")
        lang = "en"

    # Estimate audio duration from file size (rough: ~16KB/sec for webm/opus)
    estimated_duration = len(audio_bytes) / 16000.0

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                files = {
                    "file": (filename, audio_bytes, mime_type.split(";")[0]),
                }
                data = {
                    "model": MODELS.get("stt_groq", "whisper-large-v3-turbo"),
                    "response_format": "verbose_json",
                    "temperature": "0",       # Deterministic — reduces hallucination
                }
                if lang:
                    data["language"] = lang

                response = await client.post(
                    f"{GROQ_BASE_URL}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    files=files,
                    data=data,
                )

            if response.status_code == 200:
                result = response.json()

                # Extract text — handle both simple and verbose response formats
                if isinstance(result, dict):
                    text = result.get("text", "").strip()
                    detected_lang = result.get("language", lang or "en")
                    # Try to extract confidence from segments if available
                    segments = result.get("segments", [])
                    if segments:
                        avg_conf = sum(
                            s.get("avg_logprob", -0.5) for s in segments
                        ) / len(segments)
                        # Convert log probability to 0–1 confidence
                        confidence = max(0.0, min(1.0, 1.0 + avg_conf))
                    else:
                        confidence = _estimate_confidence(text, estimated_duration)
                else:
                    text = str(result).strip()
                    detected_lang = lang or "en"
                    confidence = _estimate_confidence(text, estimated_duration)

                logger.info(f"Groq Whisper [{detected_lang}]: '{text[:80]}' ({response.elapsed.total_seconds():.2f}s)")

                return {
                    "text": text,
                    "confidence": round(confidence, 2),
                    "duration_hint": round(estimated_duration, 1),
                    "language": detected_lang,
                }

            elif response.status_code == 429:
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                logger.warning(f"Rate limited (attempt {attempt + 1}/{MAX_RETRIES}), waiting {delay}s...")
                await asyncio.sleep(delay)
                last_error = Exception(f"Rate limited: {response.status_code}")

            elif response.status_code >= 500:
                delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
                error_detail = response.text[:200]
                logger.warning(f"Server error {response.status_code} (attempt {attempt + 1}): {error_detail}")
                await asyncio.sleep(delay)
                last_error = Exception(f"Server error: {response.status_code} — {error_detail}")

            else:
                error_detail = response.text[:200]
                logger.error(f"Transcription failed: {response.status_code} — {error_detail}")
                raise Exception(f"Transcription failed: {response.status_code}")

        except httpx.TimeoutException:
            delay = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
            logger.warning(f"Timeout (attempt {attempt + 1}), retrying in {delay}s...")
            await asyncio.sleep(delay)
            last_error = Exception("Transcription timed out")

        except Exception as e:
            if any(k in str(e) for k in ("Rate limited", "Server error", "timed out")):
                continue
            logger.error(f"Unexpected transcribe error: {type(e).__name__}: {e}")
            raise

    raise last_error or Exception("Transcription failed after retries")


def _estimate_confidence(text: str, duration_hint: float) -> float:
    """
    Heuristic confidence estimation when Whisper doesn't provide scores.
    """
    if not text.strip():
        return 0.0

    words = text.split()
    word_count = len(words)

    # Very short text from long audio = likely bad
    if duration_hint > 3.0 and word_count < 3:
        return 0.3

    # Reasonable word rate: ~2-4 words per second
    if duration_hint > 0:
        words_per_sec = word_count / duration_hint
        if words_per_sec < 0.5:
            return 0.4
        elif words_per_sec > 8.0:
            return 0.5  # Suspiciously fast

    # Good length = higher confidence
    if word_count >= 5:
        return 0.80
    elif word_count >= 3:
        return 0.70
    else:
        return 0.55
