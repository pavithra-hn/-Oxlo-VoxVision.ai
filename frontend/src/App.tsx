import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import VoiceMode from './components/VoiceMode';
import VisionMode from './components/VisionMode';
import type { Mode } from './types';
import { Mic, Eye } from 'lucide-react';

export default function App() {
  const [mode, setMode] = useState<Mode>('voice');

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden font-sans selection:bg-[rgba(0,170,255,0.2)]" style={{ background: '#05070D' }}>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(5, 7, 13, 0.9)',
            backdropFilter: 'blur(20px)',
            color: '#e0f0ff',
            border: '1px solid rgba(0, 170, 255, 0.15)',
            fontSize: '13px',
            borderRadius: '999px',
            padding: '12px 24px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 0 15px rgba(0,170,255,0.1)',
          },
        }}
      />

      {/* ── Floating Header ─────────────────────────────────────── */}
      <header className="absolute top-0 left-0 right-0 z-50 px-6 py-5 pointer-events-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between pointer-events-auto">
          
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/logo-icon.png"
              alt="Oxlo VoxVision.ai"
              style={{
                height: '40px',
                width: 'auto',
                filter: 'drop-shadow(0 0 10px rgba(0, 170, 255, 0.5))',
              }}
            />
            <div>
              <h1 className="text-lg font-bold leading-tight" style={{ color: '#e0f0ff' }}>
                Oxlo <span style={{ color: '#00AAFF' }}>VoxVision</span><span className="text-xs font-normal" style={{ color: 'rgba(0,170,255,0.5)' }}>.ai</span>
              </h1>
              <p className="text-[10px] font-medium uppercase" style={{ color: 'rgba(0, 170, 255, 0.6)', letterSpacing: '0.04em' }}>
                Multimodal AI
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex p-1 rounded-full shadow-xl" 
            style={{
              background: 'rgba(5, 7, 13, 0.7)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(0, 170, 255, 0.1)',
            }}
          >
            {([
              { id: 'voice' as Mode, icon: Mic, label: 'Voice' },
              { id: 'vision' as Mode, icon: Eye, label: 'Vision' },
            ]).map(({ id, icon: Icon, label }) => {
              const isActive = mode === id;
              return (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className="relative flex items-center gap-2.5 px-6 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 cursor-pointer"
                  style={{ color: isActive ? '#FFFFFF' : 'rgba(0, 170, 255, 0.35)', textShadow: isActive ? '0 0 10px rgba(0, 170, 255, 0.8)' : 'none' }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-mode-bubble"
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: 'linear-gradient(135deg, rgba(0,170,255,0.2), rgba(0,136,204,0.1))',
                        border: '1px solid rgba(0, 170, 255, 0.4)',
                        boxShadow: '0 0 20px rgba(0, 170, 255, 0.25)',
                      }}
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <Icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Status Badges */}
          <div className="hidden md:flex items-center opacity-40">
            <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400"
              style={{ letterSpacing: '0.06em' }}
            >
              Powered by: <span style={{ color: 'rgba(0, 170, 255, 0.8)' }}>Kimi • Kokoro • Yolo</span>
            </span>
          </div>
          
        </div>
      </header>

      {/* ── Main Canvas ─────────────────────────────────────────── */}
      <main className="flex-1 w-full h-full relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.02, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.98, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {mode === 'voice' ? <VoiceMode /> : <VisionMode />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
