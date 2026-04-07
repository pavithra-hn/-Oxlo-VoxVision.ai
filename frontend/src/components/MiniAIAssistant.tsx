import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';

export default function MiniAIAssistant({ phase, isGeneratingImage, hasMessages }: { phase: string, isGeneratingImage: boolean, hasMessages: boolean }) {
  const [hint, setHint] = useState("Hi! You can ask me to create images too.");
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show initially
    if (!hasMessages && phase === 'idle' && !isGeneratingImage) {
      setHint("Hi! You can ask me to create images too.");
      setIsVisible(true);
      const timer = setTimeout(() => setIsVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [hasMessages, phase, isGeneratingImage]);

  useEffect(() => {
    if (phase === 'recording') {
      setHint("Try saying: create an image of a dragon");
      setIsVisible(true);
      const timer = setTimeout(() => setIsVisible(false), 5000);
      return () => clearTimeout(timer);
    } else if (phase === 'speaking' && hasMessages) {
      setHint("Want to make it more realistic?");
      setIsVisible(true);
      const timer = setTimeout(() => setIsVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [phase, hasMessages]);

  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-none flex flex-col items-end gap-3">
      {/* Tooltip Bubble */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="relative pr-8 pl-4 py-2.5 rounded-2xl shadow-xl pointer-events-auto"
            style={{
              background: 'rgba(5, 7, 13, 0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(0,170,255,0.2)',
              color: 'rgba(255,255,255,0.9)',
              fontSize: '12px',
              maxWidth: '220px',
              lineHeight: '1.4',
            }}
          >
            {hint}
            <button 
              onClick={() => setIsVisible(false)}
              className="absolute top-1/2 -translate-y-1/2 right-2 p-1 rounded-full opacity-60 hover:opacity-100 hover:bg-white/10 transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Avatar */}
      <motion.div
        animate={{
          boxShadow: [
            '0 0 15px rgba(0,170,255,0.2)',
            '0 0 25px rgba(0,170,255,0.6)',
            '0 0 15px rgba(0,170,255,0.2)'
          ],
        }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
        className="w-12 h-12 rounded-full flex items-center justify-center pointer-events-auto cursor-pointer"
        style={{
          background: 'radial-gradient(circle at 30% 30%, #00AAFF, #004488)',
          border: '1px solid rgba(0,170,255,0.4)',
        }}
        onClick={() => setIsVisible(v => !v)}
      >
        <Sparkles className="w-5 h-5 text-white opacity-80" />
      </motion.div>
    </div>
  );
}
