import { useRef, useCallback, useEffect, useState } from 'react';

interface VADOptions {
  /** RMS threshold to detect speech (0–1). Default 0.015 */
  threshold?: number;
  /** Milliseconds of silence before auto-stopping. Default 1800 */
  silenceMs?: number;
  /** Milliseconds after start before VAD activates. Default 400 */
  delayMs?: number;
  /** Callback when speech is detected */
  onSpeechStart?: () => void;
  /** Callback when silence is detected (auto-stop) */
  onSilence?: () => void;
  /** Callback with current audio level (0–1) for visualization */
  onLevel?: (level: number) => void;
}

/**
 * Voice Activity Detection hook using Web Audio API.
 * Monitors microphone input and detects speech start/stop.
 */
export function useVAD(
  mediaStream: MediaStream | null,
  active: boolean,
  options: VADOptions = {}
) {
  const {
    threshold = 0.015,
    silenceMs = 1800,
    delayMs = 400,
    onSpeechStart,
    onSilence,
    onLevel,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechDetectedRef = useRef(false);
  const startTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (contextRef.current?.state !== 'closed') {
      contextRef.current?.close().catch(() => {});
    }
    contextRef.current = null;
    analyserRef.current = null;
    speechDetectedRef.current = false;
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    if (!mediaStream || !active) {
      cleanup();
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;

    const source = ctx.createMediaStreamSource(mediaStream);
    source.connect(analyser);

    contextRef.current = ctx;
    analyserRef.current = analyser;
    startTimeRef.current = Date.now();

    const dataArray = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!analyserRef.current) return;

      analyser.getFloatTimeDomainData(dataArray);

      // Compute RMS (root mean square) for volume level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Report level for visualization
      onLevel?.(Math.min(1, rms * 10));

      const elapsed = Date.now() - startTimeRef.current;
      const inPrimingPeriod = elapsed < delayMs;

      if (rms > threshold && !inPrimingPeriod) {
        // Speech detected
        if (!speechDetectedRef.current) {
          speechDetectedRef.current = true;
          setIsSpeaking(true);
          onSpeechStart?.();
        }

        // Reset silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (speechDetectedRef.current && !inPrimingPeriod) {
        // Silence after speech — start timer
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            setIsSpeaking(false);
            onSilence?.();
            silenceTimerRef.current = null;
          }, silenceMs);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaStream, active]);

  return { isSpeaking };
}
