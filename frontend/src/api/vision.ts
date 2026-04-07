import type { DetectionBox } from '../types';

const BASE = import.meta.env.VITE_API_URL || '';

async function visionFetch(url: string, body: object, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Vision timed out — AI model is busy, please try again');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function extractError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.detail || fallback;
  } catch {
    return fallback;
  }
}

interface VisionResult {
  text: string;
  detections: DetectionBox[];
}

// ── Live Vision Analysis ─────────────────────────────────────────────────────

export async function analyzeFrame(
  imageBase64: string,
  userPrompt?: string,
  history: Array<{ role: string; content: string }> = [],
  language: string = 'en',
): Promise<VisionResult> {
  const res = await visionFetch('/api/vision/analyze', {
    image_base64: imageBase64,
    user_prompt: userPrompt ?? null,
    history,
    language,
  });
  if (!res.ok) {
    const msg = await extractError(res, 'Vision analysis failed — AI model busy, retrying...');
    throw new Error(msg);
  }
  return res.json();
}

// ── Language-aware TTS for Vision Mode ───────────────────────────────────────

export async function speakVisionText(text: string, language: string = 'en'): Promise<void> {
  const res = await fetch(`${BASE}/api/vision/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  if (!res.ok) return;

  const arrayBuffer = await res.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);

  return new Promise((resolve) => {
    source.onended = () => { audioCtx.close(); resolve(); };
    source.start(0);
  });
}


// ── Creative Vision Features ─────────────────────────────────────────────────

export interface WhatIfResult {
  scene_description: string;
  narration: string;
  generated_image_b64: string;
  detections: DetectionBox[];
  model_used: string;
}

export async function whatIfReality(
  imageBase64: string,
  whatIfPrompt: string,
  history: Array<{ role: string; content: string }> = [],
  language: string = 'en',
): Promise<WhatIfResult> {
  const res = await visionFetch('/api/vision/whatif', {
    image_base64: imageBase64,
    what_if_prompt: whatIfPrompt,
    history,
    language,
  }, 90_000);
  if (!res.ok) {
    const msg = await extractError(res, 'What If generation failed — please try again');
    throw new Error(msg);
  }
  return res.json();
}


export interface BiographyResult {
  object_name: string;
  biography: string;
  origin_image_b64: string;
  model_used: string;
}

export async function objectBiography(
  imageBase64: string,
  objectLabel?: string,
  objectBbox?: number[],
  history: Array<{ role: string; content: string }> = [],
  language: string = 'en',
): Promise<BiographyResult> {
  const res = await visionFetch('/api/vision/biography', {
    image_base64: imageBase64,
    object_label: objectLabel ?? null,
    object_bbox: objectBbox ?? null,
    history,
    language,
  }, 90_000);
  if (!res.ok) {
    const msg = await extractError(res, 'Biography generation failed — please try again');
    throw new Error(msg);
  }
  return res.json();
}


export interface SceneDirectorResult {
  genre: string;
  title: string;
  tagline: string;
  trailer_script: string;
  poster_image_b64: string;
  detections: DetectionBox[];
  model_used: string;
}

export async function sceneDirector(
  imageBase64: string,
  history: Array<{ role: string; content: string }> = [],
  language: string = 'en',
): Promise<SceneDirectorResult> {
  const res = await visionFetch('/api/vision/scene-director', {
    image_base64: imageBase64,
    history,
    language,
  }, 90_000);
  if (!res.ok) {
    const msg = await extractError(res, 'Scene Director failed — please try again');
    throw new Error(msg);
  }
  return res.json();
}


// ── Voice Integration for Vision Mode ───────────────────────────────────────

export async function visionTranscribe(
  audioBlob: Blob,
  language: string = 'en',
): Promise<{ text: string; confidence: number; language: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('language', language);

  const res = await fetch(`${BASE}/api/vision/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw new Error('Voice transcription failed');
  return res.json();
}

export async function fetchSupportedLanguages(): Promise<
  Array<{ code: string; name: string }>
> {
  try {
    const res = await fetch(`${BASE}/api/vision/languages`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.languages || [];
  } catch {
    return [];
  }
}
