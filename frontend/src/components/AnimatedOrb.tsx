import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { AppState } from '../types';

interface Props {
  state: AppState;
  audioLevel?: number;
}

// ── Simplex-style noise (fast 2D) ──────────────────────────────
function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  const n2 = Math.sin(x * 4.898 + y * 17.33) * 23421.631;
  const n3 = Math.sin(x * 7.233 + y * 45.164) * 32165.112;
  return (Math.sin(n) + Math.sin(n2) + Math.cos(n3)) / 3;
}

function smoothNoise(x: number, y: number): number {
  return noise2D(x, y) * 0.5 + noise2D(x * 2.1, y * 2.1) * 0.3 + noise2D(x * 4.3, y * 4.3) * 0.2;
}

// ── Ribbon strand data ─────────────────────────────────────────
interface Ribbon {
  phase: number;       // starting angle offset
  speed: number;       // orbit speed
  radiusBase: number;  // base orbit radius
  width: number;       // ribbon thickness
  length: number;      // how many segments
  hueShift: number;    // subtle color variation
  noiseOffset: number; // unique noise seed
  tiltX: number;       // 3D-like tilt
  tiltY: number;
}

function createRibbons(count: number): Ribbon[] {
  const ribbons: Ribbon[] = [];
  for (let i = 0; i < count; i++) {
    ribbons.push({
      phase: Math.random() * Math.PI * 2,
      speed: 0.15 + Math.random() * 0.4,
      radiusBase: 30 + Math.random() * 70,
      width: 0.5 + Math.random() * 2,
      length: 40 + Math.floor(Math.random() * 40),
      hueShift: Math.random() * 40 - 20,
      noiseOffset: Math.random() * 100,
      tiltX: (Math.random() - 0.5) * 0.8,
      tiltY: (Math.random() - 0.5) * 0.8,
    });
  }
  return ribbons;
}

export default function AnimatedOrb({ state, audioLevel = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ribbonsRef = useRef<Ribbon[]>(createRibbons(120));
  const timeRef = useRef(0);
  const rafRef = useRef(0);
  const stateRef = useRef(state);
  const audioRef = useRef(audioLevel);
  stateRef.current = state;
  audioRef.current = audioLevel;

  const SIZE = 340;
  const CENTER = SIZE / 2;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const al = audioRef.current;
    
    // Speed varies by state
    const speedMul = s === 'listening' ? 1.8 + al * 2 : s === 'thinking' ? 0.6 : s === 'speaking' ? 1.2 + al * 1.5 : 0.4;
    timeRef.current += 0.008 * speedMul;
    const t = timeRef.current;

    // Clear with fade trail (creates the ribbon trail effect)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(5, 7, 13, 0.15)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Additive blending — overlapping ribbons glow brighter
    ctx.globalCompositeOperation = 'lighter';

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 130, 0, Math.PI * 2);
    ctx.clip();

    const ribbons = ribbonsRef.current;
    const audioBoost = 1 + al * 1.5;

    for (const ribbon of ribbons) {
      ctx.beginPath();

      const baseHue = 205 + ribbon.hueShift; // blue range (around 205 = electric blue)
      const saturation = 80 + al * 20;
      const lightness = 50 + al * 20;

      for (let j = 0; j < ribbon.length; j++) {
        const segT = t * ribbon.speed + ribbon.phase + j * 0.08;
        
        // Noise-driven displacement for organic flow
        const nx = smoothNoise(segT * 0.3 + ribbon.noiseOffset, j * 0.1) * 35 * audioBoost;
        const ny = smoothNoise(segT * 0.25 + ribbon.noiseOffset + 50, j * 0.12) * 35 * audioBoost;

        // Orbital position with 3D-like tilt
        const angle = segT + j * 0.04;
        const r = ribbon.radiusBase + Math.sin(segT * 2 + j * 0.1) * 15 * audioBoost;

        // Fake 3D projection
        const x3d = Math.cos(angle) * r;
        const y3d = Math.sin(angle) * r;
        const z3d = Math.sin(angle * ribbon.tiltX + t * 0.5) * r * 0.5;

        const perspective = 1 + z3d * 0.002;
        const x = CENTER + (x3d * Math.cos(ribbon.tiltY) + z3d * Math.sin(ribbon.tiltY)) * perspective + nx;
        const y = CENTER + (y3d + z3d * ribbon.tiltX * 0.3) * perspective + ny;

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      // Ribbon opacity — higher when audio is active, fades at edges
      const baseOpacity = s === 'idle' ? 0.08 : 0.06 + al * 0.12;
      ctx.strokeStyle = `hsla(${baseHue}, ${saturation}%, ${lightness}%, ${baseOpacity})`;
      ctx.lineWidth = ribbon.width * (1 + al * 0.5);
      ctx.stroke();

      // Bright inner glow for some ribbons
      if (ribbon.radiusBase < 60) {
        ctx.strokeStyle = `hsla(${baseHue + 20}, 90%, 75%, ${baseOpacity * 0.5})`;
        ctx.lineWidth = ribbon.width * 0.5;
        ctx.stroke();
      }
    }

    ctx.restore();

    // ── Center bright core glow ────────────────────────────
    ctx.globalCompositeOperation = 'lighter';
    const coreGlow = ctx.createRadialGradient(CENTER, CENTER, 0, CENTER, CENTER, 60 + al * 20);
    coreGlow.addColorStop(0, `rgba(0, 170, 255, ${0.15 + al * 0.2})`);
    coreGlow.addColorStop(0.5, `rgba(0, 136, 204, ${0.05 + al * 0.08})`);
    coreGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGlow;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Outer bloom
    const outerGlow = ctx.createRadialGradient(CENTER, CENTER, 80, CENTER, CENTER, 160);
    outerGlow.addColorStop(0, `rgba(0, 170, 255, ${0.03 + al * 0.04})`);
    outerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = outerGlow;
    ctx.fillRect(0, 0, SIZE, SIZE);

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = SIZE;
      canvas.height = SIZE;
      // Fill initial black
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#05070D';
        ctx.fillRect(0, 0, SIZE, SIZE);
      }
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const isActive = state !== 'idle';
  const ringSpeed = state === 'listening' ? 3 : state === 'thinking' ? 2 : state === 'speaking' ? 4 : 10;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 340, height: 340 }}>

      {/* ── Outermost ambient glow ─────────────────────────────── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 400,
          height: 400,
          background: `radial-gradient(circle, rgba(0,170,255,${0.2 + audioLevel * 0.3}), transparent 70%)`,
          filter: 'blur(60px)',
        }}
        animate={{
          scale: isActive ? [1, 1.1 + audioLevel * 0.15, 1] : [1, 1.05, 1],
          opacity: [0.3 + audioLevel * 0.3, 0.5 + audioLevel * 0.3, 0.3 + audioLevel * 0.3],
        }}
        transition={{ duration: isActive ? 1 : 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* ── HUD Ring 1 ────────────────────────────────────────── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 300,
          height: 300,
          border: '1px solid transparent',
          borderTopColor: 'rgba(0,170,255,0.25)',
          borderRightColor: 'rgba(0,170,255,0.08)',
          borderLeftColor: 'rgba(0,170,255,0.15)',
          filter: 'drop-shadow(0 0 4px rgba(0,170,255,0.1))',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: ringSpeed, repeat: Infinity, ease: 'linear' }}
      />

      {/* ── HUD Ring 2 (dashed) ───────────────────────────────── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 285,
          height: 285,
          border: '1px dashed rgba(0,170,255,0.08)',
          borderTopColor: 'rgba(0,170,255,0.2)',
          borderBottomColor: 'rgba(0,170,255,0.2)',
        }}
        animate={{ rotate: -360 }}
        transition={{ duration: ringSpeed * 1.5, repeat: Infinity, ease: 'linear' }}
      />

      {/* ── HUD Ring 3 ────────────────────────────────────────── */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 270,
          height: 270,
          border: '1px solid rgba(0,170,255,0.04)',
          borderRightColor: 'rgba(0,170,255,0.2)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: ringSpeed * 2.5, repeat: Infinity, ease: 'linear' }}
      />

      {/* ── Compass notches ───────────────────────────────────── */}
      {[0, 90, 180, 270].map(deg => (
        <div
          key={deg}
          className="absolute"
          style={{
            width: 2,
            height: 10,
            background: 'rgba(0,170,255,0.25)',
            top: '50%',
            left: '50%',
            transformOrigin: '50% 0',
            transform: `rotate(${deg}deg) translateY(-142px)`,
            borderRadius: 1,
            boxShadow: '0 0 4px rgba(0,170,255,0.15)',
          }}
        />
      ))}

      {/* ── Speaking pulse rings ───────────────────────────────── */}
      {state === 'speaking' && [1, 1.25, 1.5].map((s, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ width: 260, height: 260, border: '1px solid rgba(0,170,255,0.2)' }}
          animate={{ scale: [s, s * 1.4], opacity: [0.4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }}
        />
      ))}

      {/* ── Listening ripple ──────────────────────────────────── */}
      {state === 'listening' && (
        <motion.div
          className="absolute rounded-full"
          style={{ width: 270, height: 270, border: '2px solid rgba(0,170,255,0.3)' }}
          animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ══  THE CANVAS ORB — Flowing Energy Ribbons  ════════════ */}
      {/* ══════════════════════════════════════════════════════════ */}
      <canvas
        ref={canvasRef}
        className="relative z-10 rounded-full"
        style={{
          width: SIZE,
          height: SIZE,
          filter: `drop-shadow(0 0 ${20 + audioLevel * 30}px rgba(0,170,255,${0.3 + audioLevel * 0.3}))`,
        }}
      />
    </div>
  );
}
