/**
 * visionVoice.ts — API client for the Smart Vision Voice Assistant
 *
 * Endpoints:
 *   /api/vision/voice/greeting  — first-frame personalized greeting
 *   /api/vision/voice/pipeline  — full voice+vision pipeline
 */

import type { DetectionBox } from '../types';

const BASE = import.meta.env.VITE_API_URL || '';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VisionVoiceGreetingResult {
  greeting_text: string;
  detections: DetectionBox[];
}

export interface VisionVoicePipelineResult {
  raw_transcript: string;
  cleaned_transcript: string;
  intent: string;
  vision_used: boolean;
  response: string;
  detections: DetectionBox[];
  needs_recapture: boolean;
  recapture_message: string;
  detected_language: string;
  language_name: string;
  pipeline_metadata: Record<string, unknown>;
}

// ── Greeting — First Frame Analysis ─────────────────────────────────────────

export async function visionVoiceGreeting(
  frameBase64: string,
  language: string = 'en',
): Promise<VisionVoiceGreetingResult> {
  const form = new FormData();
  form.append('frame', frameBase64);
  form.append('language', language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${BASE}/api/vision/voice/greeting`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => 'Greeting failed');
      throw new Error(detail);
    }

    return res.json();
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Greeting timed out — please try again');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Full Pipeline — Audio + Frame ───────────────────────────────────────────

export async function visionVoicePipeline(
  audioBlob: Blob,
  frameBase64: string | null,
  history: Array<{ role: string; content: string }>,
  language: string = 'en',
): Promise<VisionVoicePipelineResult> {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('frame', frameBase64 || '');
  form.append('history', JSON.stringify(history));
  form.append('language', language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${BASE}/api/vision/voice/pipeline`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => 'Pipeline failed');
      throw new Error(detail);
    }

    return res.json();
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Vision pipeline timed out — please try again');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
