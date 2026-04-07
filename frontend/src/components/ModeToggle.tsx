import { motion } from 'framer-motion';
import { Mic, Eye } from 'lucide-react';
import type { Mode } from '../types';

export default function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="relative flex rounded-full p-1"
      style={{
        background: 'rgba(0, 170, 255, 0.04)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0, 170, 255, 0.1)',
      }}
    >
      {/* Sliding pill */}
      <motion.div
        layout
        className="absolute inset-y-1 rounded-full"
        style={{
          left: mode === 'voice' ? '4px' : 'calc(50%)',
          width: 'calc(50% - 4px)',
          background: 'rgba(0, 170, 255, 0.1)',
          border: '1px solid rgba(0, 170, 255, 0.2)',
          boxShadow: '0 0 15px rgba(0, 170, 255, 0.1)',
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      />
      {(['voice', 'vision'] as Mode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="relative z-10 flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium cursor-pointer"
          style={{
            color: mode === m ? '#00AAFF' : 'rgba(0, 170, 255, 0.3)',
            transition: 'color 0.2s ease',
          }}
        >
          {m === 'voice' ? <Mic className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {m === 'voice' ? 'Voice' : 'Vision'}
        </button>
      ))}
    </div>
  );
}
