import logging
import base64
import httpx
from app.services.oxlo_client import oxlo
from app.config import MODELS, IMAGE_DEFAULT_SIZE, OXLO_API_KEY, OXLO_BASE_URL

logger = logging.getLogger("Oxlo VoxVision.ai.image")


async def generate_image(
    prompt: str,
    model: str | None = None,
    size: str | None = None,
) -> dict:
    """
    Generate an image from a text prompt using Oxlo.ai image models.

    Tries primary model (oxlo-image-pro), falls back to flux.1-schnell.
    Uses the OpenAI-compatible images.generate() endpoint with b64_json.

    Returns: { "image_b64": str, "model_used": str, "revised_prompt": str | None }
    """
    target_model = model or MODELS["image"]
    target_size = size or IMAGE_DEFAULT_SIZE

    # Try primary model, then fallback
    models_to_try = [target_model]
    if target_model == MODELS["image"]:
        models_to_try.append(MODELS["image_fast"])
    elif target_model == MODELS["image_fast"]:
        models_to_try.append(MODELS["image"])

    last_error = None

    for m in models_to_try:
        try:
            logger.info(f"Generating image with model={m}, size={target_size}")

            # Use OpenAI-compatible images.generate endpoint
            response = await oxlo.images.generate(
                model=m,
                prompt=prompt,
                n=1,
                size=target_size,
                response_format="b64_json",
            )

            image_data = response.data[0]
            b64 = image_data.b64_json
            revised = getattr(image_data, "revised_prompt", None)

            logger.info(f"Image generated successfully with model={m} ({len(b64) if b64 else 0} chars b64)")

            return {
                "image_b64": b64,
                "model_used": m,
                "revised_prompt": revised,
            }

        except Exception as e:
            logger.warning(f"Image generation failed with model={m}: {type(e).__name__}: {e}")
            last_error = e
            continue

    # If the OpenAI SDK approach fails, try raw HTTP as backup
    try:
        logger.info("Trying raw HTTP image generation as fallback...")
        result = await _generate_image_http(prompt, MODELS["image_fast"], target_size)
        return result
    except Exception as e:
        logger.error(f"Raw HTTP image generation also failed: {e}")

    raise last_error or Exception("All image generation models failed")


async def _generate_image_http(
    prompt: str,
    model: str,
    size: str,
) -> dict:
    """
    Fallback: raw HTTP call to Oxlo.ai /v1/images/generations endpoint.
    Some providers don't fully support the OpenAI SDK for image gen.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{OXLO_BASE_URL}/images/generations",
            headers={
                "Authorization": f"Bearer {OXLO_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                "size": size,
                "response_format": "b64_json",
            },
        )

    if response.status_code != 200:
        raise Exception(f"Image API returned {response.status_code}: {response.text[:200]}")

    data = response.json()
    image_data = data.get("data", [{}])[0]
    b64 = image_data.get("b64_json", "")
    revised = image_data.get("revised_prompt")

    if not b64:
        # Maybe the API returned a URL instead
        url = image_data.get("url", "")
        if url:
            b64 = await _download_image_as_b64(url)

    return {
        "image_b64": b64,
        "model_used": model,
        "revised_prompt": revised,
    }


async def _download_image_as_b64(url: str) -> str:
    """Download an image from a URL and return as base64 string."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
    if response.status_code != 200:
        raise Exception(f"Failed to download image: {response.status_code}")
    return base64.b64encode(response.content).decode("utf-8")
