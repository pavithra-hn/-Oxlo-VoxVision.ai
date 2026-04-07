import logging
from fastapi import APIRouter, HTTPException
from app.models.schemas import CompoundRequest, CompoundResponse
from app.services.compound_service import execute_compound_request
from app.services.intent_service import detect_intent_fast

logger = logging.getLogger("Oxlo VoxVision.ai.compound")

router = APIRouter(prefix="/api/compound", tags=["Compound"])


@router.post("/generate", response_model=CompoundResponse)
async def generate_compound(req: CompoundRequest):
    """
    Generate a compound response: Image + Structured Text.

    Handles requests like: "Generate an image of a pizza and explain ingredients and steps"
    Execution: Image first → Structured text second.
    Returns both outputs plus a short voice summary for TTS.
    """
    try:
        # Detect intent and extract image subject
        intent_result = detect_intent_fast(req.prompt)
        image_subject = intent_result.get("image_subject", req.prompt)

        logger.info(
            f"Compound generation: prompt='{req.prompt[:80]}', "
            f"subject='{image_subject}', intent={intent_result.get('intent')}"
        )

        history = [m.model_dump() for m in req.history] if req.history else []

        result = await execute_compound_request(
            prompt=req.prompt,
            image_subject=image_subject,
            history=history,
            image_model=req.image_model,
            image_size=req.image_size,
        )

        return CompoundResponse(
            image_b64=result["image_b64"],
            image_model_used=result["image_model_used"],
            structured_text=result["structured_text"],
            title=result["title"],
            domain=result["domain"],
            voice_summary=result["voice_summary"],
            prompt=req.prompt,
            revised_prompt=result.get("revised_prompt"),
        )

    except Exception as e:
        logger.error(f"Compound generation error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Compound generation failed: {str(e)}"
        )
