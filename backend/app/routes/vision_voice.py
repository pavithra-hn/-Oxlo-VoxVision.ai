"""
vision_voice.py — Smart Vision Voice Assistant Routes

Sub-router under /api/vision/voice/ for the enhanced vision mode:
  • /greeting  — First-frame personalized greeting
  • /pipeline  — Full voice+vision pipeline (STT → intent → vision/chat)
"""

import time
import json
import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.models.schemas import VisionVoiceGreetingResponse, VisionVoicePipelineResult
from app.services.vision_voice_service import (
    generate_greeting,
    detect_vision_need,
    vision_aware_chat,
    text_only_chat,
    check_needs_recapture,
    route_intent,
    vision_image_generate,
)
from app.services.stt_service import transcribe
from app.services.preprocessing_service import (
    clean_transcript, is_valid_input, extract_confidence_label,
    enrich_intent, _repair_trailing_fragment,
)
from app.services.language_service import reconcile_language
from app.services.intent_service import detect_intent_fast
from app.services.response_cleaner import clean_response

logger = logging.getLogger("Oxlo VoxVision.ai.vision_voice")

router = APIRouter(prefix="/api/vision/voice", tags=["Vision Voice"])


# ── Greeting ─────────────────────────────────────────────────────────────────

@router.post("/greeting", response_model=VisionVoiceGreetingResponse)
async def vision_voice_greeting(
    frame: str = Form(...),
    language: str = Form("en"),
):
    """
    First-frame greeting flow:
    Camera just opened → analyze user + scene → personalized greeting.
    No audio needed — this is a visual-only analysis.
    """
    try:
        if not frame or len(frame) < 100:
            raise HTTPException(status_code=400, detail="No valid frame provided")

        logger.info("Vision voice greeting: lang=%s frame_size=%d", language, len(frame))
        result = await generate_greeting(frame, language)

        return VisionVoiceGreetingResponse(
            greeting_text=result["greeting_text"],
            detections=result.get("detections", []),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Vision voice greeting error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Full Pipeline ────────────────────────────────────────────────────────────

@router.post("/pipeline", response_model=VisionVoicePipelineResult)
async def vision_voice_pipeline(
    audio: UploadFile = File(...),
    frame: str = Form(default=""),
    history: str = Form(default="[]"),
    language: str = Form(default="en"),
):
    """
    Smart vision + voice pipeline:
    1. Transcribe audio (Sarvam → Whisper)
    2. Clean + validate transcript
    3. Detect if vision is needed (intent classifier)
    4. If vision needed + frame available → Vision LLM with frame + transcript
    5. If no vision needed → Chat LLM text-only (faster)
    6. Check for recapture signals
    7. Return unified result
    """
    t_start = time.time()

    # Parse history
    try:
        history_list = json.loads(history) if history else []
        parsed_history = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history_list
            if isinstance(m, dict) and "role" in m and "content" in m
        ]
    except (json.JSONDecodeError, TypeError):
        parsed_history = []

    try:
        audio_bytes = await audio.read()

        # ── Audio too short ───────────────────────────────────────────────
        if len(audio_bytes) < 5000:
            return VisionVoicePipelineResult(
                raw_transcript="",
                cleaned_transcript="",
                intent="unknown",
                vision_used=False,
                response="I didn't catch that — could you try again?",
                detected_language=language,
                language_name="English",
            )

        # ── 1. ASR Transcription ──────────────────────────────────────────
        asr_result = await transcribe(audio_bytes, audio.content_type or "audio/webm")
        raw_text = asr_result["text"]
        confidence = asr_result["confidence"]
        stt_lang = asr_result.get("stt_detected_language", asr_result.get("language", "en"))
        stt_engine = asr_result.get("engine", "unknown")

        logger.info(
            "Vision voice STT: '%s' (conf=%.2f, stt_lang=%s, engine=%s)",
            raw_text[:60], confidence, stt_lang, stt_engine,
        )

        # ── 2. Clean + repair + validate ──────────────────────────────────
        cleaned = clean_transcript(raw_text)
        cleaned = _repair_trailing_fragment(cleaned)
        valid, reason = is_valid_input(cleaned)

        if not valid or not cleaned.strip():
            return VisionVoicePipelineResult(
                raw_transcript=raw_text,
                cleaned_transcript=cleaned,
                intent="unknown",
                vision_used=False,
                response="I didn't quite catch that — could you say that again?",
                detected_language=language,
                language_name="English",
                pipeline_metadata={
                    "latency_ms": int((time.time() - t_start) * 1000),
                    "validation_reason": reason,
                },
            )

        # ── 3. Language reconciliation ────────────────────────────────────
        detected_language, language_name = reconcile_language(stt_lang, cleaned)

        # ── 4. Intent enrichment ──────────────────────────────────────────
        enriched = enrich_intent(cleaned, detected_language)
        intent_result = detect_intent_fast(enriched)
        intent = intent_result["intent"]

        # ── 5. Intent Router — central routing layer ─────────────────
        has_frame = bool(frame and len(frame) > 100)
        routed_intent = route_intent(enriched, has_frame)

        logger.info(
            "Vision voice router: routed_intent=%s has_frame=%s intent=%s lang=%s",
            routed_intent, has_frame, intent, detected_language,
        )

        # ── 6. Route to the appropriate handler ───────────────────
        if routed_intent == "image_generation" and has_frame:
            # Image generation: VLM describe → constrained prompt → image gen
            result = await vision_image_generate(
                frame, enriched, detected_language,
            )
        elif routed_intent == "vision_analysis":
            # Vision-aware chat: send frame + transcript to Vision LLM
            result = await vision_aware_chat(
                frame, enriched, parsed_history, detected_language,
            )
        else:
            # Text-only chat: skip vision, faster response
            result = await text_only_chat(
                enriched, parsed_history, detected_language,
            )

        latency_ms = int((time.time() - t_start) * 1000)
        logger.info(
            "Vision voice pipeline: routed=%s vision_used=%s image_gen=%s recapture=%s latency=%dms",
            routed_intent, result["vision_used"],
            result.get("image_generated", False),
            result.get("needs_recapture", False), latency_ms,
        )

        return VisionVoicePipelineResult(
            raw_transcript=raw_text,
            cleaned_transcript=enriched,
            intent=intent,
            vision_used=result["vision_used"],
            response=result["response"],
            detections=result.get("detections", []),
            needs_recapture=result.get("needs_recapture", False),
            recapture_message=result.get("recapture_message", ""),
            detected_language=detected_language,
            language_name=language_name,
            image_generated=result.get("image_generated", False),
            generated_image_b64=result.get("generated_image_b64"),
            image_model_used=result.get("model_used", ""),
            pipeline_metadata={
                "latency_ms": latency_ms,
                "stt_engine": stt_engine,
                "routed_intent": routed_intent,
                "had_frame": has_frame,
                "asr_confidence": confidence,
            },
        )

    except Exception as e:
        logger.error("Vision voice pipeline error: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=500, detail=str(e))
