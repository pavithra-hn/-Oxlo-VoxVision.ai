export type Mode = 'voice' | 'vision';

export type AppState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  imageUrl?: string;          // Base64 data URL for generated images
  metadata?: {
    raw_input?: string;
    cleaned_input?: string;
    intent?: string;
    confidence?: number;
    confidence_label?: string;
    model_used?: string;
  };
}

export interface DetectionBox {
  label: string;
  confidence: number;
  bbox: number[];
}

export interface TranscribeResult {
  text: string;
  confidence: number;
  confidence_label: string;
  is_valid: boolean;
  needs_clarification: boolean;
  cleaned_text: string;
  intent: string;
  detected_language: string;    // e.g. "kn", "ta", "en"
  language_name: string;        // e.g. "Kannada", "English"
  engine?: string;              // "sarvam" | "groq" — which STT engine was used
}

export interface PipelineResult {
  raw_input: string;
  cleaned_input: string;
  intent: string;
  asr_confidence: number;
  confidence_label: string;
  is_valid: boolean;
  validation_reason: string;
  needs_clarification: boolean;
  response: string;
  pipeline_metadata: Record<string, unknown>;
  detected_language: string;
  language_name: string;
}

export interface ImageGenerateResult {
  image_b64: string;
  model_used: string;
  prompt: string;
  revised_prompt?: string;
}

export interface CompoundResult {
  image_b64: string;
  image_model_used: string;
  structured_text: string;
  title: string;
  domain: string;
  voice_summary: string;
  prompt: string;
  revised_prompt?: string;
}
