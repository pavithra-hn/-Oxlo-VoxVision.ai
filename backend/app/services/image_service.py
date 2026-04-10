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


# ── Image-to-Image (img2img) ────────────────────────────────────────────────
# Uses /v1/images/edits endpoint for direct camera frame → styled image

async def generate_image_from_image(
    image_b64: str,
    prompt: str,
    model: str | None = None,
    strength: float = 0.75,
) -> dict:
    """
    Transform an existing image using a text prompt (img2img).

    Uses the Oxlo /v1/images/edits endpoint.
    Supported models: stable-diffusion-1.5, sdxl_lightning, oxlo-image-pro.

    Args:
        image_b64: Base64-encoded source image (JPEG from webcam)
        prompt: Style/transformation prompt (e.g. "anime style portrait")
        model: Image model to use (defaults to oxlo-image-pro)
        strength: How much to transform (0.0 = no change, 1.0 = full generation)

    Returns: { "image_b64": str, "model_used": str, "revised_prompt": str | None }
    """
    target_model = model or MODELS["image"]

    # Models to try: primary → fallback
    models_to_try = [target_model]
    if target_model == MODELS["image"]:
        models_to_try.append(MODELS["image_fast"])

    image_data_url = f"data:image/jpeg;base64,{image_b64}"
    last_error = None

    for m in models_to_try:
        try:
            logger.info(f"img2img: model={m}, strength={strength}, prompt_len={len(prompt)}")

            # Try OpenAI-compatible images.edit() endpoint
            response = await oxlo.images.edit(
                model=m,
                image=image_data_url,
                prompt=prompt,
                extra_body={"strength": strength},
            )

            img_data = response.data[0]
            b64 = img_data.b64_json
            revised = getattr(img_data, "revised_prompt", None)

            if b64:
                logger.info(f"img2img success with model={m} ({len(b64)} chars)")
                return {
                    "image_b64": b64,
                    "model_used": m,
                    "revised_prompt": revised,
                }

        except Exception as e:
            logger.warning(f"img2img SDK failed with model={m}: {type(e).__name__}: {e}")
            last_error = e
            continue

    # Fallback: try raw HTTP to /v1/images/edits
    try:
        logger.info("img2img: trying raw HTTP fallback...")
        result = await _img2img_http(image_data_url, prompt, MODELS["image"], strength)
        return result
    except Exception as e:
        logger.warning(f"img2img raw HTTP also failed: {e}")

    # Final fallback: use text-to-image with descriptive prompt
    logger.info("img2img: all img2img methods failed, falling back to text-to-image")
    enhanced_prompt = f"{prompt}. High quality, detailed, professional illustration."
    result = await generate_image(prompt=enhanced_prompt)
    return result


async def _img2img_http(
    image_data_url: str,
    prompt: str,
    model: str,
    strength: float,
) -> dict:
    """
    Raw HTTP fallback for img2img via /v1/images/edits endpoint.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            f"{OXLO_BASE_URL}/images/edits",
            headers={
                "Authorization": f"Bearer {OXLO_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "image": image_data_url,
                "prompt": prompt,
                "strength": strength,
            },
        )

    if response.status_code != 200:
        raise Exception(f"img2img API returned {response.status_code}: {response.text[:200]}")

    data = response.json()
    img_data = data.get("data", [{}])[0]
    b64 = img_data.get("b64_json", "")
    revised = img_data.get("revised_prompt")

    if not b64:
        url = img_data.get("url", "")
        if url:
            b64 = await _download_image_as_b64(url)

    if not b64:
        raise Exception("img2img API returned no image data")

    return {
        "image_b64": b64,
        "model_used": model,
        "revised_prompt": revised,
    }
