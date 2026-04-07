import type { ImageGenerateResult } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Generate an image from a text prompt via the backend.
 * Returns base64 image data + metadata.
 */
export async function generateImage(
  prompt: string,
  model?: string,
  size?: string
): Promise<ImageGenerateResult> {
  const res = await fetch(`${API}/api/image/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: model ?? null,
      size: size ?? null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => 'Image generation failed');
    throw new Error(detail);
  }

  return res.json();
}

/**
 * Get available image generation models.
 */
export async function getImageModels(): Promise<{
  models: Array<{ id: string; name: string; tier: string; speed: string }>;
  default_model: string;
  default_size: string;
  available_sizes: string[];
}> {
  const res = await fetch(`${API}/api/image/models`);
  if (!res.ok) throw new Error('Failed to fetch image models');
  return res.json();
}
