import { useEffect, useRef } from 'react';
import type { DetectionBox } from '../types';

// Electric blue palette for detection boxes
const COLORS = ['#00AAFF', '#0099E6', '#0088CC', '#33BBFF', '#66CCFF', '#007AB3'];

interface Props {
  detections: DetectionBox[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function DetectionOverlay({ detections, videoRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.offsetWidth;
    canvas.height = video.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = canvas.width / (video.videoWidth || 640);
    const scaleY = canvas.height / (video.videoHeight || 480);

    detections.forEach((d, i) => {
      const [x, y, w, h] = d.bbox;
      const color = COLORS[i % COLORS.length];

      // Mirror the x coordinate (because video is mirrored)
      const mirroredX = canvas.width - (x + w) * scaleX;
      const drawY = y * scaleY;
      const drawW = w * scaleX;
      const drawH = h * scaleY;

      // Box with blue glow
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(mirroredX, drawY, drawW, drawH);
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Corner accents with glow
      const cornerLen = 14;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      
      // Top-left
      ctx.beginPath();
      ctx.moveTo(mirroredX, drawY + cornerLen);
      ctx.lineTo(mirroredX, drawY);
      ctx.lineTo(mirroredX + cornerLen, drawY);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(mirroredX + drawW - cornerLen, drawY);
      ctx.lineTo(mirroredX + drawW, drawY);
      ctx.lineTo(mirroredX + drawW, drawY + cornerLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(mirroredX, drawY + drawH - cornerLen);
      ctx.lineTo(mirroredX, drawY + drawH);
      ctx.lineTo(mirroredX + cornerLen, drawY + drawH);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(mirroredX + drawW - cornerLen, drawY + drawH);
      ctx.lineTo(mirroredX + drawW, drawY + drawH);
      ctx.lineTo(mirroredX + drawW, drawY + drawH - cornerLen);
      ctx.stroke();

      ctx.shadowBlur = 0;

      // Label background — blue tinted
      const label = `${d.label} ${Math.round(d.confidence * 100)}%`;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const textW = ctx.measureText(label).width + 12;
      const labelH = 22;
      ctx.fillStyle = color + '25';
      ctx.beginPath();
      ctx.roundRect(mirroredX, drawY - labelH - 4, textW, labelH, 4);
      ctx.fill();
      ctx.strokeStyle = color + '60';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label text
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.fillText(label, mirroredX + 6, drawY - 10);
      ctx.shadowBlur = 0;
    });
  }, [detections, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ transform: 'none' }}
    />
  );
}
