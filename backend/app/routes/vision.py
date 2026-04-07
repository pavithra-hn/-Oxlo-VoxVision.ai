from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from app.models.schemas import (
    VisionRequest, VisionResponse, SpeakRequest,
    WhatIfRequest, WhatIfResponse,
    BiographyRequest, BiographyResponse,
    SceneDirectorRequest, SceneDirectorResponse,
)
from app.services.vision_service import analyze_frame
from app.services.vision_creative_service import what_if_reality, object_biography, scene_director
from app.services.tts_service import synthesize
from app.services.stt_service import transcribe          # Sarvam (primary) → Whisper (fallback)
from app.services.response_cleaner import clean_response
from app.config import SUPPORTED_LANGUAGES
import logging

logger = logging.getLogger("Oxlo VoxVision.ai.vision_routes")

router = APIRouter(prefix="/api/vision", tags=["Vision"])


@router.post("/analyze", response_model=VisionResponse)
async def analyze_webcam_frame(req: VisionRequest):
    """
    Receive base64 webcam frame.
    Runs Kimi K2.5 vision (primary) + YOLO v11 (fallback).
    Returns text description + detection boxes.
    """
    try:
        language = req.language or "en"
        text, detections = await analyze_frame(
            req.image_base64,
            req.user_prompt,
            [m.model_dump() for m in req.history],
            language=language,
        )
        return VisionResponse(text=clean_response(text), detections=detections)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speak")
async def vision_speak(req: SpeakRequest):
    """Synthesize the vision response as audio.
    Passes language so Indian languages route to gTTS.
    """
    try:
        language = req.language or "en"
        audio_bytes = await synthesize(req.text, language=language)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/transcribe")
async def vision_transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en"),
):
    """
    Transcribe voice input for Vision Mode queries.
    Supports multi-language (en, hi, te, ta, kn, es, fr, ja).
    """
    try:
        audio_bytes = await audio.read()

        if len(audio_bytes) < 3000:
            return {"text": "", "confidence": 0.0, "language": language}

        lang = language if language in SUPPORTED_LANGUAGES else "en"
        result = await transcribe(audio_bytes, audio.content_type or "audio/webm", language=lang)

        logger.info(f"Vision STT [{lang}]: '{result['text'][:60]}'")
        return {
            "text": result["text"],
            "confidence": result["confidence"],
            "language": result.get("language", lang),
        }
    except Exception as e:
        logger.error(f"Vision transcribe error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/languages")
async def get_supported_languages():
    """Return list of supported languages for STT/TTS."""
    return {
        "languages": [
            {"code": code, "name": info["name"]}
            for code, info in SUPPORTED_LANGUAGES.items()
        ]
    }


# ── Creative Vision Features ─────────────────────────────────────────────────


@router.post("/whatif", response_model=WhatIfResponse)
async def vision_what_if(req: WhatIfRequest):
    """
    'What If' Reality Engine:
    Camera frame + scenario → Kimi scene understanding → Image generation
    Returns reimagined scene + narration.
    """
    try:
        result = await what_if_reality(
            req.image_base64,
            req.what_if_prompt,
            [m.model_dump() for m in req.history],
            language=req.language or "en",
        )
        # Clean all text fields
        if 'scene_description' in result:
            result['scene_description'] = clean_response(result['scene_description'])
        if 'narration' in result:
            result['narration'] = clean_response(result['narration'])
        return WhatIfResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/biography", response_model=BiographyResponse)
async def vision_biography(req: BiographyRequest):
    """
    Object Biographies:
    Camera frame + selected object → Kimi imagines life story → Image of origin.
    """
    try:
        result = await object_biography(
            req.image_base64,
            req.object_label,
            req.object_bbox,
            [m.model_dump() for m in req.history],
            language=req.language or "en",
        )
        # Clean text fields
        if 'biography' in result:
            result['biography'] = clean_response(result['biography'])
        if 'object_name' in result:
            result['object_name'] = clean_response(result['object_name'])
        return BiographyResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scene-director", response_model=SceneDirectorResponse)
async def vision_scene_director(req: SceneDirectorRequest):
    """
    Scene Director:
    Camera frame → genre classification → movie poster + trailer script.
    """
    try:
        result = await scene_director(
            req.image_base64,
            [m.model_dump() for m in req.history],
            language=req.language or "en",
        )
        # Clean text fields
        if 'trailer_script' in result:
            result['trailer_script'] = clean_response(result['trailer_script'])
        if 'tagline' in result:
            result['tagline'] = clean_response(result['tagline'])
        return SceneDirectorResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
