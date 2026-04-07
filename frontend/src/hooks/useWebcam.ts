import { useRef, useState, useCallback, useEffect } from 'react';

export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Frame caching for instant availability ──────────────────
  const latestFrameRef = useRef<string | null>(null);
  const cacheIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setActive(true);
      }
    } catch {
      setError('Camera access denied. Please allow permissions and reload.');
    }
  }, []);

  const stop = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    // Stop frame cache when camera stops
    if (cacheIntervalRef.current) {
      clearInterval(cacheIntervalRef.current);
      cacheIntervalRef.current = null;
    }
    latestFrameRef.current = null;
  }, []);

  // Capture current frame as base64 JPEG string
  const captureFrame = useCallback((quality = 0.80): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1]; // base64 only, no prefix
  }, []);

  // ── Periodic frame cache (every 3s) ─────────────────────────
  // Stores a low-quality frame so it's instantly available when user speaks
  const startFrameCache = useCallback(() => {
    // Immediately capture one
    const frame = captureFrame(0.6);
    if (frame) latestFrameRef.current = frame;

    cacheIntervalRef.current = setInterval(() => {
      const f = captureFrame(0.6);
      if (f) latestFrameRef.current = f;
    }, 3000);
  }, [captureFrame]);

  const stopFrameCache = useCallback(() => {
    if (cacheIntervalRef.current) {
      clearInterval(cacheIntervalRef.current);
      cacheIntervalRef.current = null;
    }
    latestFrameRef.current = null;
  }, []);

  // Get the most recent cached frame (instant, no delay)
  const getLatestFrame = useCallback(() => latestFrameRef.current, []);

  // Capture a fresh high-quality frame (for on-demand vision analysis)
  const captureFreshFrame = useCallback((): string | null => {
    const frame = captureFrame(0.85);
    if (frame) latestFrameRef.current = frame;
    return frame;
  }, [captureFrame]);

  useEffect(() => () => {
    stop();
  }, [stop]);

  return {
    videoRef, active, error, start, stop, captureFrame,
    // New: frame caching for smart vision
    startFrameCache, stopFrameCache, getLatestFrame, captureFreshFrame,
  };
}
