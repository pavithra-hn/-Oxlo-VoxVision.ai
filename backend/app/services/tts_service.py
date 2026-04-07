"""
tts_service.py
──────────────
Text-to-Speech pipeline with multilingual support.

Routing logic:
  - English + Latin languages  → Kokoro 82M via Oxlo.ai (high quality)
  - Indian languages (kn/ta/te/hi) → gTTS (Google Translate TTS, free, Indic support)
  - Japanese / other non-Latin  → gTTS

gTTS produces MP3 bytes natively — same format as Kokoro, so the pipeline is transparent.
"""

import io
import logging
from app.services.oxlo_client import oxlo
from app.services.language_service import get_tts_config
from app.config import MODELS

logger = logging.getLogger("Oxlo VoxVision.ai.tts")


async def synthesize(text: str, language: str = "en") -> bytes:
    """
    Convert text to speech.

    Args:
        text:     The text to synthesize (must be in native script for non-English)
        language: ISO 639-1 language code (e.g. "en", "kn", "ta", "te", "hi")

    Returns:
        Raw MP3 audio bytes
    """
    if not text or not text.strip():
        logger.warning("TTS: empty text received, returning empty bytes")
        return b""

    tts_cfg = get_tts_config(language)
    engine = tts_cfg["engine"]

    logger.info(
        f"TTS: lang={language} ({tts_cfg['lang_name']}) engine={engine} "
        f"text='{text[:60]}{'...' if len(text) > 60 else ''}'"
    )

    if engine == "gtts":
        return await _gtts_synthesize(text, tts_cfg["gtts_lang"])
    else:
        return await _kokoro_synthesize(text, tts_cfg["kokoro_voice"])


async def _kokoro_synthesize(text: str, voice: str = "af_heart") -> bytes:
    """
    Synthesize using Kokoro 82M via Oxlo.ai.
    Best for English and Latin-script languages.
    """
    try:
        response = await oxlo.audio.speech.create(
            model=MODELS["tts"],
            input=text,
            voice=voice,
            response_format="mp3",
        )
        logger.info(f"Kokoro TTS: {len(response.content)} bytes returned")
        return response.content
    except Exception as e:
        logger.error(f"Kokoro TTS failed: {type(e).__name__}: {e}")
        # Fallback to gTTS English if Kokoro fails
        logger.info("Falling back to gTTS English")
        return await _gtts_synthesize(text, "en")


async def _gtts_synthesize(text: str, gtts_lang: str) -> bytes:
    """
    Synthesize using gTTS (Google Translate TTS).
    Supports: kn (Kannada), ta (Tamil), te (Telugu), hi (Hindi), ja, etc.
    Free, no API key needed.
    Returns MP3 bytes.
    """
    import asyncio
    from gtts import gTTS

    def _generate() -> bytes:
        buf = io.BytesIO()
        tts = gTTS(text=text, lang=gtts_lang, slow=False)
        tts.write_to_fp(buf)
        buf.seek(0)
        return buf.read()

    try:
        # Run blocking gTTS call in a thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, _generate)
        logger.info(f"gTTS [{gtts_lang}]: {len(audio_bytes)} bytes returned")
        return audio_bytes
    except Exception as e:
        logger.error(f"gTTS synthesis failed [{gtts_lang}]: {type(e).__name__}: {e}")
        # Final fallback — try Kokoro English
        logger.info("gTTS failed, falling back to Kokoro English")
        return await _kokoro_synthesize(text, voice="af_heart")
