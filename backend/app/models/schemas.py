from pydantic import BaseModel, ConfigDict
from typing import Optional, List


# Suppress 'model_' protected namespace warnings for 'model_used' fields
_SAFE_CONFIG = ConfigDict(protected_namespaces=())


class ChatMessage(BaseModel):
    role: str      # "user" | "assistant" | "system"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    mode: Optional[str] = "text"           # "voice" | "text"
    input_type: Optional[str] = "text"     # "speech" | "text"
    language: Optional[str] = None         # ISO 639-1 language hint from frontend


class PipelineRequest(BaseModel):
    """Request for the full voice pipeline with optional history for context."""
    history: List[ChatMessage] = []        # Conversation history for context retention
    language: Optional[str] = None         # Language hint from frontend


class VisionRequest(BaseModel):
    image_base64: str          # JPEG base64 string from canvas
    user_prompt: Optional[str] = None
    history: List[ChatMessage] = []
    language: Optional[str] = "en"    # ISO 639-1 language code for LLM response


class SpeakRequest(BaseModel):
    text: str
    language: Optional[str] = "en"    # ISO 639-1: "en", "kn", "ta", "te", "hi"


class DetectionBox(BaseModel):
    label: str
    confidence: float
    bbox: List[float]          # [x, y, width, height]


class VisionResponse(BaseModel):
    text: str
    detections: List[DetectionBox] = []


# ── Structured pipeline response ─────────────────────────────────────────────

class PipelineResult(BaseModel):
    """Full structured output from the voice pipeline."""
    raw_input: str                          # Original ASR transcript
    cleaned_input: str                      # Preprocessed / cleaned text
    intent: str                             # question | command | conversational
    asr_confidence: float                   # 0.0–1.0 ASR confidence score
    confidence_label: str                   # high | medium | low | very_low
    is_valid: bool                          # Whether input passed validation
    validation_reason: str                  # ok | empty | too_short | noise
    needs_clarification: bool               # Whether to ask user to repeat
    response: str                           # LLM response text
    pipeline_metadata: dict = {}            # Extra info (timing, model used, etc.)
    detected_language: str = "en"           # Detected target language code
    language_name: str = "English"          # Human-readable language name


class TranscribeResponse(BaseModel):
    """Response from the transcribe endpoint."""
    text: str
    confidence: float = 0.0
    confidence_label: str = "unknown"
    is_valid: bool = True
    needs_clarification: bool = False
    cleaned_text: str = ""
    intent: str = "conversational"
    detected_language: str = "en"        # Detected target language code
    language_name: str = "English"       # Human-readable language name


# ── Image Generation ─────────────────────────────────────────────────────────

class ImageGenerateRequest(BaseModel):
    """Request to generate an image from a text prompt."""
    prompt: str
    model: Optional[str] = None    # "oxlo-image-pro" | "flux.1-schnell"
    size: Optional[str] = None     # "1024x1024" | "1024x1792" | "1792x1024"


class ImageGenerateResponse(BaseModel):
    model_config = _SAFE_CONFIG
    """Response from the image generation endpoint."""
    image_b64: str                 # Base64-encoded PNG image data
    model_used: str                # Which model was actually used
    prompt: str                    # The prompt that was used
    revised_prompt: Optional[str] = None  # Model-revised prompt if any


# ── Vision Creative Features ─────────────────────────────────────────────────

class WhatIfRequest(BaseModel):
    """Request for the 'What If' Reality Engine."""
    image_base64: str              # Camera frame
    what_if_prompt: str            # e.g. "What if this was underwater?"
    history: List[ChatMessage] = []
    language: Optional[str] = "en"    # Language for narration


class WhatIfResponse(BaseModel):
    model_config = _SAFE_CONFIG
    """Response from the 'What If' Reality Engine."""
    scene_description: str         # Kimi's description of the current scene
    narration: str                 # Spoken narration of the alternate reality
    generated_image_b64: str       # The reimagined scene image
    detections: List[DetectionBox] = []
    model_used: str = ""


class BiographyRequest(BaseModel):
    """Request for Object Biographies."""
    image_base64: str              # Camera frame
    object_label: Optional[str] = None   # YOLO label of tapped object
    object_bbox: Optional[List[float]] = None  # Bounding box [x, y, w, h] (normalized 0-1)
    history: List[ChatMessage] = []
    language: Optional[str] = "en"    # Language for biography text


class BiographyResponse(BaseModel):
    model_config = _SAFE_CONFIG
    """Response from Object Biographies."""
    object_name: str               # What the object is
    biography: str                 # The imagined life story
    origin_image_b64: str          # Generated image of a key moment
    model_used: str = ""


class SceneDirectorRequest(BaseModel):
    """Request for Scene Director / Movie Poster."""
    image_base64: str              # Camera frame
    history: List[ChatMessage] = []
    language: Optional[str] = "en"    # Language for title/tagline/script


class SceneDirectorResponse(BaseModel):
    model_config = _SAFE_CONFIG
    """Response from Scene Director."""
    genre: str                     # Detected movie genre
    title: str                     # Generated movie title
    tagline: str                   # Movie tagline
    trailer_script: str            # 30-second trailer narration
    poster_image_b64: str          # Generated movie poster
    detections: List[DetectionBox] = []
    model_used: str = ""


# ── Compound Multi-Intent ────────────────────────────────────────────────────

class CompoundRequest(BaseModel):
    """Request for compound multi-intent (image + structured text)."""
    prompt: str                    # Full user prompt
    history: List[ChatMessage] = []
    image_model: Optional[str] = None    # "oxlo-image-pro" | "flux.1-schnell"
    image_size: Optional[str] = None     # "1024x1024" | etc.


class CompoundResponse(BaseModel):
    """Response from compound multi-intent generation."""
    image_b64: str                 # Base64-encoded image
    image_model_used: str          # Which image model was used
    structured_text: str           # Full structured text (markdown-formatted)
    title: str                     # Extracted title (e.g. "Chocolate Cake")
    domain: str                    # Detected domain (food, diy, character, etc.)
    voice_summary: str             # Short TTS-friendly summary (1-2 sentences)
    prompt: str                    # Original prompt
    revised_prompt: Optional[str] = None  # Image model-revised prompt


# ── Vision Voice (Smart Vision Assistant) ────────────────────────────────────

class VisionVoiceGreetingResponse(BaseModel):
    """Response from the vision voice greeting (first frame analysis)."""
    greeting_text: str                 # Personalized greeting text
    detections: List[DetectionBox] = []


class VisionVoicePipelineResult(BaseModel):
    """Unified result from the vision voice pipeline."""
    raw_transcript: str                # Original ASR transcript
    cleaned_transcript: str            # Preprocessed text
    intent: str                        # question | command | conversational
    vision_used: bool                  # Whether frame was sent to Vision LLM
    response: str                      # AI response text
    detections: List[DetectionBox] = []
    needs_recapture: bool = False      # AI couldn't see clearly
    recapture_message: str = ""        # "Hold it closer to camera"
    detected_language: str = "en"
    language_name: str = "English"
    pipeline_metadata: dict = {}

