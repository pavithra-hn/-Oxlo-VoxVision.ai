import logging
from fastapi import APIRouter, HTTPException
from app.models.schemas import ImageGenerateRequest, ImageGenerateResponse
from app.services.image_service import generate_image
from app.config import MODELS, IMAGE_DEFAULT_SIZE

logger = logging.getLogger("Oxlo VoxVision.ai.image")

router = APIRouter(prefix="/api/image", tags=["Image"])


@router.post("/generate", response_model=ImageGenerateResponse)
async def generate_image_endpoint(req: ImageGenerateRequest):
    """
    Generate an image from a text prompt.

    Uses Oxlo Image Pro (primary) or Flux.1 Schnell (fast).
    Returns base64-encoded image data.
    """
    try:
        logger.info(f"Image generation request: prompt='{req.prompt[:80]}', model={req.model}, size={req.size}")

        result = await generate_image(
            prompt=req.prompt,
            model=req.model,
            size=req.size,
        )

        logger.info(f"Image generated: model_used={result['model_used']}")

        return ImageGenerateResponse(
            image_b64=result["image_b64"],
            model_used=result["model_used"],
            prompt=req.prompt,
            revised_prompt=result.get("revised_prompt"),
        )

    except Exception as e:
        logger.error(f"Image generation error: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Image generation failed: {str(e)}"
        )


@router.get("/models")
async def list_image_models():
    """List available image generation models."""
    return {
        "models": [
            {
                "id": MODELS["image"],
                "name": "Oxlo Image Pro",
                "tier": "Premium",
                "speed": "standard",
            },
            {
                "id": MODELS["image_fast"],
                "name": "Flux.1 Schnell",
                "tier": "Pro",
                "speed": "fast",
            },
        ],
        "default_model": MODELS["image"],
        "default_size": IMAGE_DEFAULT_SIZE,
        "available_sizes": ["1024x1024", "1024x1792", "1792x1024"],
    }
