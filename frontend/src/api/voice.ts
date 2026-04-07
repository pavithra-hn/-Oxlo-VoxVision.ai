import type { TranscribeResult } from '../types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Transcribe audio blob — sends WebM/Opus to backend.
 * Primary STT: Sarvam Saaras v3 (Indian-language optimised, code-mix support).
 * Fallback STT: Groq Whisper Large v3 Turbo (broad multilingual).
 * Returns transcript + detected language + confidence.
 */
export async function transcribeAudio(blob: Blob): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');

  const res = await fetch(`${API}/api/voice/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => 'Transcription failed');
    throw new Error(detail);
  }

  return res.json();
}

/**
 * Stream LLM response as SSE tokens.
 * Passes detected language so the LLM responds in the correct native script.
 */
export async function* streamChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  options: { mode?: string; input_type?: string; language?: string } = {}
): AsyncGenerator<string> {
  const { mode = 'text', input_type = 'text', language = 'en' } = options;

  const res = await fetch(`${API}/api/voice/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, mode, input_type, language }),
  });

  if (!res.ok || !res.body) throw new Error('Chat stream failed');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });

    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6);
        if (payload === '[DONE]') return;
        if (payload.startsWith('[ERROR]')) throw new Error(payload.slice(8));
        yield payload;
      }
    }
  }
}

/**
 * Text to speech.
 * Passes language code so the backend routes to the correct TTS engine:
 *   English        → Kokoro 82M (Oxlo.ai, high quality)
 *   kn/ta/te/hi   → gTTS (Google Translate, native Indic)
 */
export async function speakText(text: string, language: string = 'en'): Promise<void> {
  const res = await fetch(`${API}/api/voice/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });

  if (!res.ok) throw new Error('TTS failed');

  const audioBlob = await res.blob();
  const url = URL.createObjectURL(audioBlob);
  const audio = new Audio(url);

  return new Promise((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Audio playback failed')); };
    audio.play().catch(reject);
  });
}

/**
 * Non-streaming validated chat — calls backend /chat endpoint
 * which uses chat_full() with post-generation quality gate + auto-retry.
 * Use as a fallback when streaming produces incomplete output.
 */
export async function chatFullValidated(
  message: string,
  history: Array<{ role: string; content: string }>,
  options: { mode?: string; language?: string } = {}
): Promise<{ text: string; detected_language: string; language_name: string }> {
  const { mode = 'voice', language = 'en' } = options;

  const res = await fetch(`${API}/api/voice/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, mode, language }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => 'Chat failed');
    throw new Error(detail);
  }

  return res.json();
}

