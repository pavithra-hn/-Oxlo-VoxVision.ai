import { motion } from 'framer-motion';
import type { AppState } from '../types';

const STATE_CONFIG: Record<AppState, { label: string; color: string; dotColor: string }> = {
  idle:       { label: 'Ready',      color: 'rgba(0, 170, 255, 0.5)',  dotColor: '#00AAFF' },
  listening:  { label: 'Listening',  color: 'rgba(0, 170, 255, 0.7)',  dotColor: '#00AAFF' },
  thinking:   { label: 'Processing', color: 'rgba(0, 170, 255, 0.6)',  dotColor: '#00AAFF' },
  speaking:   { label: 'Speaking',   color: 'rgba(0, 170, 255, 0.7)',  dotColor: '#00AAFF' },
  clarifying: { label: 'Clarifying', color: 'rgba(0, 170, 255, 0.6)',  dotColor: '#00AAFF' },
};

export default function StatusBadge({ state }: { state: AppState }) {
  const { label, color, dotColor } = STATE_CONFIG[state];

  return (
    <motion.div
      key={state}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 px-3 py-1 rounded-full"
      style={{
        background: 'rgba(0, 170, 255, 0.04)',
        border: '1px solid rgba(0, 170, 255, 0.1)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <motion.div
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: dotColor }}
        animate={state !== 'idle' ? { opacity: [1, 0.3, 1] } : {}}
        transition={{ repeat: Infinity, duration: 1 }}
      />
      <span className="text-xs font-medium" style={{ color, letterSpacing: '0.04em' }}>
        {label}
      </span>
    </motion.div>
  );
}
