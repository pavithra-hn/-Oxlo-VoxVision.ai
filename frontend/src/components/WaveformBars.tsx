import { useEffect, useRef, useCallback } from 'react';

interface Props {
  analyser: AnalyserNode | null;
}

const BAR_COUNT = 40;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const HEIGHT = 48;
const MIN_HEIGHT = 2;
const SMOOTHING = 0.35; // lower = snappier, higher = smoother

export default function WaveformBars({ analyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const prevHeights = useRef<number[]>(new Array(BAR_COUNT).fill(MIN_HEIGHT));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const totalWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
    canvas.width = totalWidth;
    canvas.height = HEIGHT;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get live frequency data from the microphone analyser
    let barHeights: number[];

    if (analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      // Map frequency bins to our bar count
      // Focus on lower-mid frequencies (voice range ~85Hz-1000Hz)
      const usableBins = Math.min(bufferLength, Math.floor(bufferLength * 0.6));
      const step = usableBins / BAR_COUNT;

      barHeights = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        // Average a range of bins for each bar
        const startBin = Math.floor(i * step);
        const endBin = Math.floor((i + 1) * step);
        let sum = 0;
        let count = 0;
        for (let b = startBin; b < endBin && b < bufferLength; b++) {
          sum += dataArray[b];
          count++;
        }
        const avg = count > 0 ? sum / count : 0;

        // Normalize to bar height (0-255 → MIN_HEIGHT to HEIGHT)
        const normalized = (avg / 255) * (HEIGHT - MIN_HEIGHT) + MIN_HEIGHT;

        // Smooth transition from previous frame
        const prev = prevHeights.current[i];
        const smoothed = prev + (normalized - prev) * (1 - SMOOTHING);
        barHeights.push(smoothed);
      }
    } else {
      // Fallback: gentle idle animation when no analyser
      const t = Date.now() * 0.003;
      barHeights = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const wave = Math.sin(t + i * 0.3) * 3 + MIN_HEIGHT + 2;
        barHeights.push(wave);
      }
    }

    // Store for next frame smoothing
    prevHeights.current = barHeights;

    // Draw bars with gradient
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i * (BAR_WIDTH + BAR_GAP);
      const h = barHeights[i];
      const y = (HEIGHT - h) / 2; // center vertically

      // Create per-bar gradient
      const intensity = h / HEIGHT;
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, `rgba(0, 170, 255, ${0.3 + intensity * 0.7})`);
      grad.addColorStop(0.5, `rgba(0, 200, 255, ${0.5 + intensity * 0.5})`);
      grad.addColorStop(1, `rgba(0, 170, 255, ${0.3 + intensity * 0.7})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, BAR_WIDTH, h, BAR_WIDTH / 2);
      ctx.fill();

      // Glow for tall bars
      if (intensity > 0.4) {
        ctx.shadowColor = '#00AAFF';
        ctx.shadowBlur = 6 * intensity;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [analyser]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const totalWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;

  return (
    <canvas
      ref={canvasRef}
      style={{ width: totalWidth, height: HEIGHT }}
      className="opacity-90"
    />
  );
}
