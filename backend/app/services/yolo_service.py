import httpx
import logging
import os
from typing import List
from app.config import MODELS, OXLO_BASE_URL
from app.models.schemas import DetectionBox

logger = logging.getLogger("Oxlo VoxVision.ai.yolo")


def _normalize_bbox(raw_bbox) -> list[float]:
    """
    Convert any bbox format to [x, y, width, height].
    Handles:
      - dict: {'x1': ..., 'y1': ..., 'x2': ..., 'y2': ...}
      - list of 4 floats: [x, y, w, h] or [x1, y1, x2, y2]
    """
    try:
        if isinstance(raw_bbox, dict):
            x1 = float(raw_bbox.get("x1", 0))
            y1 = float(raw_bbox.get("y1", 0))
            x2 = float(raw_bbox.get("x2", 0))
            y2 = float(raw_bbox.get("y2", 0))
            return [x1, y1, x2 - x1, y2 - y1]   # convert to [x, y, w, h]
        elif isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
            return [float(v) for v in raw_bbox]
        else:
            logger.warning("Unexpected bbox format: %s", type(raw_bbox))
            return [0.0, 0.0, 0.0, 0.0]
    except (TypeError, ValueError) as e:
        logger.warning("Failed to parse bbox: %s — %s", raw_bbox, e)
        return [0.0, 0.0, 0.0, 0.0]


async def detect_objects(image_base64: str) -> List[DetectionBox]:
    """
    Run YOLOv11 object detection on a base64 image via Oxlo.ai.
    Returns list of DetectionBox with label, confidence, bbox [x, y, w, h].
    Gracefully returns empty list on failure (never crashes the pipeline).
    """
    api_key = os.getenv("OXLO_API_KEY", "")

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                f"{OXLO_BASE_URL}/detect",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODELS["detect"],
                    "image": image_base64,
                    "confidence_threshold": 0.40,
                },
            )

        if response.status_code != 200:
            logger.warning("YOLO API returned %d — falling back", response.status_code)
            return []

        data = response.json()
        detections: List[DetectionBox] = []

        for d in data.get("detections", []):
            raw_bbox = d.get("bbox", [0, 0, 0, 0])
            bbox = _normalize_bbox(raw_bbox)

            detections.append(DetectionBox(
                label=d.get("label", "object"),
                confidence=round(float(d.get("confidence", 0.0)), 2),
                bbox=bbox,
            ))

        logger.info("YOLO detected %d objects: %s",
                     len(detections),
                     [f"{d.label}({d.confidence})" for d in detections[:5]])
        return detections

    except httpx.TimeoutException:
        logger.warning("YOLO request timed out — returning empty")
        return []
    except Exception as e:
        logger.error("YOLO detection error: %s", e)
        return []


def labels_from_detections(detections: List[DetectionBox]) -> list[str]:
    """Extract unique high-confidence labels for prompt enrichment."""
    return list({d.label for d in detections if d.confidence >= 0.50})
