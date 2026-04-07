import { useState, useRef, useCallback } from 'react';

export type RecorderState = 'idle' | 'recording' | 'processing';

const MIN_RECORDING_MS = 400;

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,       // Optimal for speech recognition
      },
    });
    streamRef.current = stream;

    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? { mimeType: 'audio/webm;codecs=opus' }
      : {};
    const mr = new MediaRecorder(stream, options);
    recorderRef.current = mr;
    chunksRef.current = [];
    startTimeRef.current = Date.now();

    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const duration = Date.now() - startTimeRef.current;
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;

      if (duration < MIN_RECORDING_MS || chunksRef.current.length === 0) {
        console.warn(`Recording too short (${duration}ms), skipping`);
        setState('idle');
        return;
      }

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setAudioBlob(blob);
      setState('processing');
    };

    mr.start(100);
    setState('recording');

    return stream;
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setState('idle');
  }, []);

  return { state, audioBlob, start, stop, reset, stream: streamRef.current };
}
