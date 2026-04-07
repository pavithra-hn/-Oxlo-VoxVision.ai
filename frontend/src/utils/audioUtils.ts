/**
 * Convert any audio Blob to WAV format using Web Audio API.
 * This ensures maximum compatibility with Whisper ASR servers.
 * Solves the "moov atom not found" error from WebM→M4A misdetection.
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: 16000 });

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const wavBuffer = encodeWav(audioBuffer);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  } finally {
    await audioCtx.close();
  }
}

function encodeWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1; // Mono is enough for speech
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const length = samples.length;

  // 16-bit PCM
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // Chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // Byte rate
  view.setUint16(32, numChannels * 2, true); // Block align
  view.setUint16(34, 16, true);           // Bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, length * 2, true);

  // Write PCM samples (float32 → int16)
  let offset = 44;
  for (let i = 0; i < length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
