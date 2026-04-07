"""
voice.py — Voice pipeline routes (v3)
──────────────────────────────────────
All endpoints now use reconcile_language() as the SINGLE source of truth
for language detection, cross-referencing STT engine + script + keywords.

Changes vs v2:
  • /transcribe  — uses reconcile_language(stt_lang, text)
  • /pipeline    — uses reconcile_language(stt_lang, text)
  • /chat/stream — now runs intent enrichment (was missing before)
  • /chat        — uses reconcile_language
  • Strict input validation: gibberish/noise → immediate "please repeat"
  • Partial sentence repair applied before enrichment
"""

import time
import json
import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, Response
from app.models.schemas import (
    ChatRequest, SpeakRequest, TranscribeResponse, PipelineResult, ChatMessage
)
from app.services.stt_service import transcribe          # Sarvam (primary) → Whisper (fallback)
from app.services.chat_service import chat_stream, chat_full
from app.services.tts_service import synthesize
from app.services.preprocessing_service import (
    clean_transcript, is_valid_input, extract_confidence_label,
    enrich_intent, _repair_trailing_fragment
)
from app.services.intent_service import detect_intent_fast
from app.services.compound_service import execute_compound_request
from app.services.language_service import (
    detect_language_from_text, build_native_script_prompt, reconcile_language
)
from app.services.response_cleaner import clean_response

logger = logging.getLogger("Oxlo VoxVision.ai.voice")

router = APIRouter(prefix="/api/voice", tags=["Voice"])

# ── Clarification responses ───────────────────────────────────────────────────
CLARIFICATION_RESPONSES = {
    "empty":          "I didn't catch that. Could you try again?",
    "too_short":      "That was a bit too short for me to understand. Could you say a bit more?",
    "noise":          "I'm having trouble hearing you clearly. Could you speak a little closer to the mic?",
    "gibberish":      "I couldn't understand that clearly. Could you please repeat?",
    "unknown_language": "I couldn't determine the language. Could you try again?",
    "low_confidence": "I'm not quite sure I got that right. Could you repeat that?",
}


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Full transcription pipeline:
    1. Validate audio size
    2. ASR transcription with confidence
    3. Clean/preprocess transcript + repair trailing fragments
    4. Validate cleaned text (gibberish, noise, too-short)
    5. Reconcile language (STT engine + script + keyword detection)
    6. Detect intent + enrich if detail requested
    Returns structured result with confidence, validation, intent, and language.
    """
    try:
        audio_bytes = await audio.read()

        if len(audio_bytes) < 5000:
            logger.warning(f"Audio too short ({len(audio_bytes)} bytes), skipping")
            return TranscribeResponse(
                text="",
                confidence=0.0,
                confidence_label="very_low",
                is_valid=False,
                needs_clarification=False,
                cleaned_text="",
                intent="unknown",
                detected_language="en",
                language_name="English",
            )

        logger.info(f"Transcribing {len(audio_bytes)} bytes ({audio.content_type})")

        # ── 1. ASR Transcription (auto-detect language) ───────────────────
        asr_result = await transcribe(audio_bytes, audio.content_type or "audio/webm")
        raw_text = asr_result["text"]
        confidence = asr_result["confidence"]
        confidence_label = extract_confidence_label(confidence)
        stt_lang = asr_result.get("stt_detected_language", asr_result.get("language", "en"))

        logger.info(f"ASR: '{raw_text[:80]}' (conf={confidence}, {confidence_label}, stt_lang={stt_lang})")

        # ── 2. Clean + repair trailing fragments ──────────────────────────
        cleaned = clean_transcript(raw_text)
        cleaned = _repair_trailing_fragment(cleaned)
        logger.info(f"Cleaned: '{cleaned[:80]}'")

        # ── 3. Validate ──────────────────────────────────────────────────
        valid, reason = is_valid_input(cleaned)

        needs_clarification = False
        if not valid:
            needs_clarification = True
        elif confidence_label in ("low", "very_low"):
            needs_clarification = True

        # ── 4. Language reconciliation (STT engine + script + keyword) ────
        detected_language, language_name = reconcile_language(stt_lang, cleaned or raw_text)

        # ── 5. Intent detection ──────────────────────────────────────────
        intent_result = detect_intent_fast(cleaned) if valid else {"intent": "unknown"}
        intent = intent_result["intent"]

        # ── 6. Intent enrichment ──────────────────────────────────────────
        enriched = enrich_intent(cleaned, detected_language)

        logger.info(
            f"Intent: {intent} | Valid: {valid} ({reason}) | "
            f"Clarify: {needs_clarification} | "
            f"Lang: {detected_language} ({language_name}) [stt_raw={stt_lang}]"
        )

        return TranscribeResponse(
            text=raw_text,
            confidence=confidence,
            confidence_label=confidence_label,
            is_valid=valid,
            needs_clarification=needs_clarification,
            cleaned_text=enriched,          # use enriched version
            intent=intent,
            detected_language=detected_language,
            language_name=language_name,
        )

    except Exception as e:
        logger.error(f"Transcribe pipeline error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")


@router.post("/pipeline")
async def full_voice_pipeline(
    audio: UploadFile = File(...),
    history: str = Form(default="[]"),
):
    """
    Complete voice pipeline in a single call:
    Transcribe → Clean → Repair → Validate → Reconcile Language → Intent → Enrich → Chat → Return.
    Accepts optional conversation history as JSON string for context retention.
    Does NOT include TTS (frontend calls /speak separately for streaming UX).
    """
    t_start = time.time()

    # Parse history from JSON string (sent as form data alongside the file)
    try:
        history_list = json.loads(history) if history else []
        # Validate into ChatMessage format
        parsed_history = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history_list
            if isinstance(m, dict) and "role" in m and "content" in m
        ]
    except (json.JSONDecodeError, TypeError):
        parsed_history = []

    try:
        audio_bytes = await audio.read()

        if len(audio_bytes) < 5000:
            return PipelineResult(
                raw_input="",
                cleaned_input="",
                intent="unknown",
                asr_confidence=0.0,
                confidence_label="very_low",
                is_valid=False,
                validation_reason="empty",
                needs_clarification=False,
                response="",
                detected_language="en",
                language_name="English",
            )

        # ── ASR ───────────────────────────────────────────────────────────
        asr_result = await transcribe(audio_bytes, audio.content_type or "audio/webm")
        raw_text   = asr_result["text"]
        confidence = asr_result["confidence"]
        conf_label = extract_confidence_label(confidence)
        stt_engine = asr_result.get("engine", "unknown")
        stt_mode   = asr_result.get("stt_mode", "unknown")
        stt_lang   = asr_result.get("stt_detected_language", asr_result.get("language", "en"))

        # ── Clean + repair ────────────────────────────────────────────────
        cleaned = clean_transcript(raw_text)
        cleaned = _repair_trailing_fragment(cleaned)
        valid, reason = is_valid_input(cleaned)

        # ── Language reconciliation (BEFORE enrichment) ───────────────────
        detected_language, language_name = reconcile_language(stt_lang, cleaned or raw_text)
        native_script_instr = build_native_script_prompt(detected_language, language_name)

        # ── Intent enrichment ─────────────────────────────────────────────
        enriched = enrich_intent(cleaned, detected_language)

        # ── Clarification check (strict: gibberish, noise, too-short, low confidence) ──
        needs_clarification = not valid or conf_label in ("low", "very_low")

        if needs_clarification:
            clarification_key = reason if not valid else "low_confidence"
            return PipelineResult(
                raw_input=raw_text,
                cleaned_input=enriched,
                intent="unknown",
                asr_confidence=confidence,
                confidence_label=conf_label,
                is_valid=valid,
                validation_reason=reason,
                needs_clarification=True,
                response=CLARIFICATION_RESPONSES.get(
                    clarification_key, CLARIFICATION_RESPONSES["low_confidence"]
                ),
                pipeline_metadata={
                    "latency_ms": int((time.time() - t_start) * 1000),
                    "stt_engine": stt_engine,
                    "stt_mode": stt_mode,
                    "stt_detected_language": stt_lang,
                    "reconciled_language": detected_language,
                },
                detected_language=detected_language,
                language_name=language_name,
            )

        # ── Intent ────────────────────────────────────────────────────────
        intent_result = detect_intent_fast(enriched)
        intent = intent_result["intent"]

        # ── COMPOUND intent → image + structured text ─────────────────────
        if intent == "compound":
            image_subject = intent_result.get("image_subject", enriched)
            compound_result = await execute_compound_request(
                prompt=enriched,
                image_subject=image_subject,
            )
            return PipelineResult(
                raw_input=raw_text,
                cleaned_input=enriched,
                intent="compound",
                asr_confidence=confidence,
                confidence_label=conf_label,
                is_valid=True,
                validation_reason="ok",
                needs_clarification=False,
                response=compound_result["voice_summary"],
                pipeline_metadata={
                    "latency_ms": int((time.time() - t_start) * 1000),
                    "intent_method": intent_result.get("method", "regex"),
                    "stt_engine": stt_engine,
                    "stt_mode": stt_mode,
                    "stt_detected_language": stt_lang,
                    "reconciled_language": detected_language,
                    "compound": True,
                    "image_b64": compound_result["image_b64"],
                    "image_model_used": compound_result["image_model_used"],
                    "structured_text": compound_result["structured_text"],
                    "title": compound_result["title"],
                    "domain": compound_result["domain"],
                    "voice_summary": compound_result["voice_summary"],
                    "revised_prompt": compound_result.get("revised_prompt"),
                },
                detected_language=detected_language,
                language_name=language_name,
            )

        # ── Regular LLM chat (now with history for context retention) ────
        response_text = await chat_full(
            user_message=raw_text,
            history=parsed_history,          # Pass conversation history!
            intent=intent,
            cleaned_input=enriched,          # enriched text drives the LLM
            mode="voice",
            target_language=detected_language,
            language_name=language_name,
            native_script_instruction=native_script_instr,
        )

        return PipelineResult(
            raw_input=raw_text,
            cleaned_input=enriched,
            intent=intent,
            asr_confidence=confidence,
            confidence_label=conf_label,
            is_valid=True,
            validation_reason="ok",
            needs_clarification=False,
            response=response_text,
            pipeline_metadata={
                "latency_ms": int((time.time() - t_start) * 1000),
                "intent_method": intent_result.get("method", "regex"),
                "stt_engine": stt_engine,
                "stt_mode": stt_mode,
                "stt_detected_language": stt_lang,
                "reconciled_language": detected_language,
            },
            detected_language=detected_language,
            language_name=language_name,
        )

    except Exception as e:
        logger.error(f"Pipeline error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def chat_streaming(req: ChatRequest):
    """
    Stream LLM response as Server-Sent Events (SSE).
    Uses Qwen 3 32B for voice (better multilingual), Kimi-K2.5 for text.
    Now includes intent enrichment and language reconciliation.
    """
    from app.config import MODELS
    history = [m.model_dump() for m in req.history]
    mode = req.mode or "text"

    # ── Language detection (with reconciliation) ──────────────────────────
    # For /chat/stream the STT hint may come from the frontend language param
    # or we detect from the message text itself
    detected_language, language_name = reconcile_language(
        stt_lang=req.language,
        transcript_text=req.message,
    )
    native_script_instr = build_native_script_prompt(detected_language, language_name)

    intent_result = detect_intent_fast(req.message)
    intent = intent_result["intent"]

    # ── Clean + repair + enrich ───────────────────────────────────────────
    cleaned = clean_transcript(req.message)
    cleaned = _repair_trailing_fragment(cleaned)
    enriched = enrich_intent(cleaned, detected_language)

    voice_model = MODELS.get("chat_voice") if mode == "voice" else None

    logger.info(
        f"Chat stream: lang={detected_language} ({language_name}) "
        f"model={voice_model or MODELS['chat']} intent={intent} "
        f"enriched={enriched != cleaned}"
    )

    async def event_generator():
        try:
            async for token in chat_stream(
                req.message, history,
                model=voice_model,
                intent=intent,
                cleaned_input=enriched,      # enriched text (was: raw cleaned)
                mode=mode,
                target_language=detected_language,
                language_name=language_name,
                native_script_instruction=native_script_instr,
            ):
                yield f"data: {token}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Chat stream error: {type(e).__name__}: {e}")
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat")
async def chat_complete(req: ChatRequest):
    """Non-streaming chat with structured prompting and multilingual support."""
    try:
        history = [m.model_dump() for m in req.history]
        intent_result = detect_intent_fast(req.message)
        mode = req.mode or "text"

        # ── Clean + repair + enrich ───────────────────────────────────────
        cleaned = clean_transcript(req.message)
        cleaned = _repair_trailing_fragment(cleaned)

        # ── Language reconciliation ───────────────────────────────────────
        detected_language, language_name = reconcile_language(
            stt_lang=req.language,
            transcript_text=req.message,
        )
        native_script_instr = build_native_script_prompt(detected_language, language_name)

        enriched = enrich_intent(cleaned, detected_language)

        text = await chat_full(
            req.message, history,
            intent=intent_result["intent"],
            cleaned_input=enriched,
            mode=mode,
            target_language=detected_language,
            language_name=language_name,
            native_script_instruction=native_script_instr,
        )
        return {"text": text, "detected_language": detected_language, "language_name": language_name}
    except Exception as e:
        logger.error(f"Chat error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speak")
async def text_to_speech(req: SpeakRequest):
    """
    Convert text to speech.
    - English → Kokoro 82M (Oxlo.ai, high quality)
    - Indian languages (kn/ta/te/hi) → gTTS (Google Translate TTS, native Indic)
    Returns raw MP3 audio bytes.
    """
    try:
        language = req.language or "en"
        logger.info(f"TTS request: lang={language} text='{req.text[:60]}'")
        audio_bytes = await synthesize(req.text, language=language)
        logger.info(f"TTS response: {len(audio_bytes)} bytes (lang={language})")
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=speech.mp3"},
        )
    except Exception as e:
        logger.error(f"TTS error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")
