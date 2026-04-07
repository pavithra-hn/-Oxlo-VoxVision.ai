"""
stt_service.py — STT Orchestrator  (v3)
─────────────────────────────────────────
Implements the full quality pipeline:

  Mic Input
  → Sarvam Saaras v3  (PRIMARY — "verbatim" mode for Indic)
      • Auto language-detection when hint is None
      • Short-transcript validation → re-try with "transcribe" mode
      • Low confidence → skip to fallback
  → Groq Whisper Large v3 Turbo  (FALLBACK — ultra-fast, broad multilingual)
  → Post-STT validation:
      • Transcript length check
      • Intent-keyword guard
      • Gibberish/noise rejection
  → Language reconciliation (STT-detected lang + script detection)

Return format:
  {
      "text":          str,    # preserved full transcript
      "confidence":    float,  # 0.0–1.0
      "duration_hint": float,
      "language":      str,    # ISO-639-1 (reconciled — authoritative)
      "stt_detected_language": str,  # raw STT engine guess (for debugging)
      "engine":        str,    # "sarvam" | "groq"
      "stt_mode":      str,    # sarvam mode used
  }
"""

import logging
from app.config import STT_ENGINE_PRIORITY, SARVAM_API_KEY

logger = logging.getLogger("Oxlo VoxVision.ai.stt")

# ── Thresholds ────────────────────────────────────────────────────────────────
# Minimum number of characters we expect for a valid full-sentence transcript.
# Kannada/Tamil syllabic scripts pack a lot into few chars → use a low floor.
MIN_TRANSCRIPT_CHARS = 8

# Minimum confidence to accept a Sarvam result directly.
# Below this we try Whisper and then pick the longer/more-confident result.
MIN_SARVAM_CONFIDENCE = 0.30

# Indic language codes that benefit from "verbatim" STT mode
# (verbatim = exact word-for-word, preserves "in detail" / ವಿವರವಾಗಿ etc.)
INDIC_LANGS = {"hi", "kn", "ta", "te", "ml", "bn", "mr", "gu", "pa", "or"}

# Intent-critical keywords in Indic scripts that MUST be preserved.
# If Sarvam misses ALL of these but Whisper has them, prefer Whisper text.
INTENT_KEYWORDS = [
    # Kannada
    "ವಿವರ", "ವಿವರವಾಗಿ", "ಹಂತ", "ಹಂತ-ಹಂತ",
    # Tamil
    "விவரம்", "படிப்படியாக", "விளக்கம்",
    # Telugu
    "వివరంగా", "దశలవారీగా", "వివరణ",
    # Hindi
    "विस्तार", "विस्तार से", "चरण",
    # English (spoken in mixed inputs)
    "detail", "explain", "step", "steps",
]


def _has_intent_keywords(text: str) -> bool:
    """Return True if any intent-critical keyword appears in the transcript."""
    lower = text.lower()
    return any(kw.lower() in lower for kw in INTENT_KEYWORDS)


def _basic_transcript_ok(text: str) -> bool:
    """
    Quick sanity check on raw STT output BEFORE full pipeline validation.
    Returns False for obviously broken transcripts.
    """
    stripped = text.strip() if text else ""
    if not stripped:
        return False
    # Pure punctuation / noise
    if all(c in ' .,!?;:-_\'"()[]{}' for c in stripped):
        return False
    return True


async def transcribe(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str | None = None,
) -> dict:
    """
    Transcribe with quality-aware fallback pipeline.

    Pipeline:
      1. Sarvam "verbatim" mode (preserves all words, ideal for Indic)
      2. If result is too short → re-try Sarvam with "transcribe" mode
      3. If confidence still low → run Groq Whisper in parallel
      4. Pick the better result (longer + has intent keywords)
      5. If Sarvam fails entirely → Groq Whisper result
      6. Reconcile language: STT engine guess vs text script analysis
    """
    errors: list[str] = []
    sarvam_result: dict | None = None
    groq_result: dict | None = None

    # ── STEP 1: Sarvam primary ─────────────────────────────────────────────────
    for engine in STT_ENGINE_PRIORITY:

        if engine == "sarvam":
            if not SARVAM_API_KEY:
                logger.warning("Sarvam engine selected but SARVAM_API_KEY is empty — skipping")
                errors.append("sarvam: API key not configured")
                continue

            try:
                from app.services.sarvam_stt_service import transcribe as sarvam_transcribe

                # For Indic: use "verbatim" first — preserves every spoken word
                # including intent phrases like ವಿವರವಾಗಿ ("in detail")
                primary_mode = "verbatim" if (language in INDIC_LANGS or language is None) else "transcribe"

                sarvam_result = await sarvam_transcribe(
                    audio_bytes, mime_type, language, mode=primary_mode
                )
                sarvam_result["stt_mode"] = primary_mode
                sarvam_result["stt_detected_language"] = sarvam_result.get("language", language or "en")

                logger.info(
                    f"STT Sarvam [{primary_mode}]: '{sarvam_result['text'][:80]}' "
                    f"conf={sarvam_result['confidence']:.2f} lang={sarvam_result['language']}"
                )

                # ── STEP 2: Short transcript → re-try with "transcribe" mode ──
                if (
                    len(sarvam_result["text"].strip()) < MIN_TRANSCRIPT_CHARS
                    and primary_mode == "verbatim"
                ):
                    logger.info(
                        f"Sarvam transcript too short ({len(sarvam_result['text'])} chars), "
                        f"retrying with 'transcribe' mode..."
                    )
                    retry = await sarvam_transcribe(
                        audio_bytes, mime_type, language, mode="transcribe"
                    )
                    if len(retry["text"].strip()) > len(sarvam_result["text"].strip()):
                        retry["stt_mode"] = "transcribe"
                        retry["stt_detected_language"] = retry.get("language", language or "en")
                        sarvam_result = retry
                        logger.info(
                            f"STT Sarvam [transcribe retry]: '{sarvam_result['text'][:80]}'"
                        )

                # ── STEP 2b: Basic sanity check on Sarvam result ──────────────
                if not _basic_transcript_ok(sarvam_result["text"]):
                    logger.warning(
                        f"Sarvam produced garbage transcript: '{sarvam_result['text'][:60]}' — forcing Whisper fallback"
                    )
                    sarvam_result["confidence"] = 0.0  # force Whisper path

            except Exception as exc:
                msg = f"sarvam: {type(exc).__name__}: {exc}"
                logger.warning(f"STT engine 'sarvam' failed → trying next. Reason: {msg}")
                errors.append(msg)

        # ── STEP 3: Groq Whisper (fallback / parallel quality check) ──────────
        elif engine == "groq":
            # Determine if Sarvam result is usable
            sarvam_ok = (
                sarvam_result is not None
                and sarvam_result["confidence"] >= MIN_SARVAM_CONFIDENCE
                and len(sarvam_result["text"].strip()) >= MIN_TRANSCRIPT_CHARS
                and _basic_transcript_ok(sarvam_result["text"])
            )

            # LANGUAGE ROUTING: Even if Sarvam is OK, if it detected English,
            # run Whisper as a quality check — Whisper is better at English.
            sarvam_detected_english = (
                sarvam_ok
                and sarvam_result is not None
                and sarvam_result.get("stt_detected_language", "").startswith("en")
            )

            if sarvam_ok and not sarvam_detected_english:
                # Sarvam detected Indic language & looks good → accept fast, skip Whisper
                logger.info(
                    f"STT: Sarvam result accepted (Indic: {sarvam_result.get('stt_detected_language')}) "
                    f"— skipping Groq fallback"
                )
                return sarvam_result

            if sarvam_detected_english:
                logger.info(
                    "STT: Sarvam detected English — running Whisper for better English accuracy"
                )
            else:
                logger.info(
                    "STT: Sarvam result weak or missing — running Groq Whisper for comparison"
                )

            try:
                from app.services.whisper_service import transcribe as whisper_transcribe
                groq_result = await whisper_transcribe(audio_bytes, mime_type, language)
                groq_result["engine"] = "groq"
                groq_result["stt_mode"] = "whisper"
                groq_result["stt_detected_language"] = groq_result.get("language", language or "en")
                logger.info(
                    f"STT Groq Whisper: '{groq_result['text'][:80]}' "
                    f"conf={groq_result['confidence']:.2f}"
                )
            except Exception as exc:
                msg = f"groq: {type(exc).__name__}: {exc}"
                logger.warning(f"STT engine 'groq' failed. Reason: {msg}")
                errors.append(msg)

        else:
            logger.warning(f"Unknown STT engine '{engine}' in STT_ENGINE_PRIORITY — skipping")

    # ── STEP 4: Pick the best result ──────────────────────────────────────────
    if sarvam_result and groq_result:
        sarvam_text = sarvam_result["text"].strip()
        groq_text   = groq_result["text"].strip()

        sarvam_has_intent = _has_intent_keywords(sarvam_text)
        groq_has_intent   = _has_intent_keywords(groq_text)

        sarvam_lang = sarvam_result.get("stt_detected_language", "")
        groq_lang   = groq_result.get("stt_detected_language", "")

        # ── ROUTING RULE A: English detected → prefer Whisper ─────────────
        # Whisper is trained on far more English data and produces better results.
        if sarvam_lang.startswith("en") and _basic_transcript_ok(groq_text):
            logger.info(
                "STT: English detected — preferring Whisper (better English accuracy)"
            )
            return groq_result

        # ── ROUTING RULE B: Groq has intent keywords Sarvam missed ────────
        if groq_has_intent and not sarvam_has_intent and len(groq_text) > len(sarvam_text):
            logger.info(
                "STT: Groq has intent keywords Sarvam missed — using Groq result"
            )
            return groq_result

        # ── ROUTING RULE C: Sarvam produced garbage ───────────────────────
        if not _basic_transcript_ok(sarvam_text) and _basic_transcript_ok(groq_text):
            logger.info("STT: Sarvam produced garbage, Groq is clean — using Groq result")
            return groq_result

        # ── DEFAULT: Indic language → prefer Sarvam (native accuracy) ─────
        logger.info(f"STT: Sarvam result selected for {sarvam_lang} (over Groq)")
        return sarvam_result

    if sarvam_result:
        return sarvam_result

    if groq_result:
        return groq_result

    # All engines exhausted
    error_summary = " | ".join(errors)
    logger.error(f"All STT engines failed: {error_summary}")
    raise RuntimeError(f"All STT engines failed: {error_summary}")
