import { useEffect, useRef, useCallback } from 'react';

/**
 * VisionBackground — Minimal, elegant ambient background.
 * Subtle breathing gradient + very faint floating particles.
 * Clean and professional like Apple/Google design.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

export default function VisionBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const timeRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);

  const initParticles = useCallback((w: number, h: number) => {
    const count = Math.min(25, Math.floor((w * h) / 60000));
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        radius: 1 + Math.random() * 1.5,
        opacity: 0.04 + Math.random() * 0.08,
      });
    }
    particlesRef.current = particles;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (particlesRef.current.length === 0) initParticles(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      timeRef.current += 0.005;
      const t = timeRef.current;
      const { width: w, height: h } = canvas;
      const cx = w / 2;
      const cy = h / 2;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // ── Subtle breathing radial gradient ──────────────────
      const breathe = Math.sin(t * 0.4) * 0.015 + 0.04;
      const grad = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy * 0.9, Math.max(w, h) * 0.6);
      grad.addColorStop(0, `rgba(0, 170, 255, ${breathe})`);
      grad.addColorStop(0.5, `rgba(0, 130, 200, ${breathe * 0.3})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // ── Floating particles (very subtle) ──────────────────
      const particles = particlesRef.current;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        const pulse = Math.sin(t * 1.5 + p.x * 0.01) * 0.02 + p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 170, 255, ${pulse})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
