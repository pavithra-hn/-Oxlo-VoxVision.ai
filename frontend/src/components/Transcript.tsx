import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Brain } from 'lucide-react';
import type { Message } from '../types';
import { cleanResponse } from '../utils/textCleaners';

const INTENT_ICONS: Record<string, React.ReactNode> = {
  question: <Brain className="w-3 h-3" />,
  command: <ShieldCheck className="w-3 h-3" />,
  conversational: null,
};

export default function Transcript({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!messages.length) return null;

  return (
    <div className="w-full max-w-md max-h-48 overflow-y-auto space-y-2 px-1 mt-2">
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={m.timestamp}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="rounded-xl px-3.5 py-2.5 text-sm leading-relaxed"
            style={{
              background: m.role === 'user'
                ? 'rgba(0, 170, 255, 0.04)'
                : 'rgba(0, 170, 255, 0.06)',
              border: `1px solid rgba(0, 170, 255, ${m.role === 'user' ? '0.1' : '0.08'})`,
              color: '#e0f0ff',
              marginLeft: m.role === 'user' ? '32px' : '0',
              marginRight: m.role === 'user' ? '0' : '32px',
            }}
          >
            <p>{m.role === 'assistant' ? cleanResponse(m.content) : m.content}</p>

            {/* Metadata badges (user messages only) */}
            {m.role === 'user' && m.metadata && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {/* Intent badge */}
                {m.metadata.intent && m.metadata.intent !== 'unknown' && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      color: 'rgba(0, 170, 255, 0.4)',
                      background: 'rgba(0, 170, 255, 0.05)',
                    }}
                  >
                    {INTENT_ICONS[m.metadata.intent]}
                    {m.metadata.intent}
                  </span>
                )}

                {/* Confidence badge */}
                {m.metadata.confidence_label && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      color: m.metadata.confidence_label === 'high'
                        ? 'rgba(0, 200, 100, 0.7)'
                        : m.metadata.confidence_label === 'medium'
                          ? 'rgba(255, 180, 50, 0.7)'
                          : 'rgba(255, 80, 80, 0.7)',
                      background: 'rgba(0, 170, 255, 0.05)',
                    }}
                  >
                    {m.metadata.confidence_label === 'high' ? (
                      <ShieldCheck className="w-2.5 h-2.5" />
                    ) : (
                      <ShieldAlert className="w-2.5 h-2.5" />
                    )}
                    {Math.round((m.metadata.confidence || 0) * 100)}%
                  </span>
                )}

                {/* Show cleaned vs raw diff */}
                {m.metadata.raw_input && m.metadata.cleaned_input
                  && m.metadata.raw_input !== m.metadata.cleaned_input && (
                  <span className="text-[10px] italic truncate max-w-[140px]"
                    style={{ color: 'rgba(0, 170, 255, 0.2)' }}
                  >
                    raw: "{m.metadata.raw_input.slice(0, 40)}"
                  </span>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
}
