import type { CompoundResult } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Generate a compound response (image + structured text) from a prompt.
 * Used for requests like: "Generate an image of a pizza and explain ingredients and steps"
 */
export async function generateCompound(
  prompt: string,
  imageModel?: string,
  imageSize?: string,
): Promise<CompoundResult> {
  const res = await fetch(`${API}/api/compound/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_model: imageModel ?? null,
      image_size: imageSize ?? null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => 'Compound generation failed');
    throw new Error(detail);
  }

  return res.json();
}

/**
 * Quick regex check for compound intent on the frontend.
 * Matches prompts that contain both image generation AND explanation keywords.
 * This mirrors the backend logic for instant UI responsiveness.
 */
export function isCompoundPrompt(text: string): boolean {
  const hasImage = /\b(generate|create|make|draw|paint|design|render|produce)\b.{0,20}\b(image|picture|photo|illustration|artwork|art|portrait|poster)\b/i.test(text)
    || /\b(image|picture|photo|illustration|artwork)\b.{0,20}\b(of|showing|with|depicting|featuring)\b/i.test(text)
    || /^\s*(generate|create|draw|paint|design|render)\b.{0,10}\b(an?|the|me|some)\b/i.test(text);

  const hasExplanation = /\b(explain|describe|tell me about|give me|list|provide)\b/i.test(text)
    || /\b(ingredients?|steps?|instructions?|recipe|how to|preparation|procedure|tutorial)\b/i.test(text)
    || /\b(step.?by.?step|detailed|complete)\b.{0,20}\b(guide|instructions?|explanation|recipe|tutorial|process)\b/i.test(text);

  return hasImage && hasExplanation;
}
