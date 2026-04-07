import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Send, Bot, User, Download, RefreshCw,
  ImagePlus, Loader2, ChevronDown, Maximize2, X,
  Zap, Crown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { generateImage } from '../api/image';
import { generateCompound, isCompoundPrompt } from '../api/compound';
import type { Message } from '../types';

type ImageSize = '1024x1024' | '1024x1792' | '1792x1024';
type ImageModel = 'oxlo-image-pro' | 'flux.1-schnell';

const SIZE_LABELS: Record<ImageSize, string> = {
  '1024x1024': 'Square',
  '1024x1792': 'Portrait',
  '1792x1024': 'Landscape',
};

const MODEL_INFO: Record<ImageModel, { label: string; icon: typeof Crown; tier: string }> = {
  'oxlo-image-pro': { label: 'Oxlo Image Pro', icon: Crown, tier: 'Premium' },
  'flux.1-schnell': { label: 'Flux.1 Schnell', icon: Zap, tier: 'Fast' },
};

const PROMPT_SUGGESTIONS = [
  'A futuristic city skyline at night with neon lights reflecting on water',
  'A serene Japanese garden with cherry blossoms in spring',
  'An astronaut playing guitar on the surface of Mars',
  'A cozy cabin in the mountains during a snowfall, warm light from windows',
  'A steampunk mechanical owl perched on ancient books',
  'An underwater palace made of coral and bioluminescent creatures',
];

export default function ImageMode() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ImageModel>('oxlo-image-pro');
  const [selectedSize, setSelectedSize] = useState<ImageSize>('1024x1024');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const sizePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
      if (sizePickerRef.current && !sizePickerRef.current.contains(e.target as Node)) {
        setShowSizePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleGenerate = useCallback(async (inputPrompt?: string) => {
    const finalPrompt = inputPrompt || prompt.trim();
    if (!finalPrompt || isGenerating) return;

    // Add user message
    const userMsg: Message = {
      role: 'user',
      content: finalPrompt,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setPrompt('');
    setIsGenerating(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      // ── Check for compound intent ─────────────────────────────
      if (isCompoundPrompt(finalPrompt)) {
        const compoundResult = await generateCompound(finalPrompt, selectedModel, selectedSize);
        const imageDataUrl = `data:image/png;base64,${compoundResult.image_b64}`;

        // Message 1: Image with short summary
        const imageMsg: Message = {
          role: 'assistant',
          content: compoundResult.voice_summary,
          timestamp: Date.now(),
          imageUrl: imageDataUrl,
          metadata: { model_used: compoundResult.image_model_used },
        };
        setMessages(prev => [...prev, imageMsg]);

        // Message 2: Structured text
        const textMsg: Message = {
          role: 'assistant',
          content: compoundResult.structured_text,
          timestamp: Date.now() + 1,
          metadata: {
            intent: 'compound_text',
            model_used: compoundResult.image_model_used,
          },
        };
        setMessages(prev => [...prev, textMsg]);
      } else {
        // ── Regular image-only generation ────────────────────────
        const result = await generateImage(finalPrompt, selectedModel, selectedSize);
        const imageDataUrl = `data:image/png;base64,${result.image_b64}`;

        const assistantMsg: Message = {
          role: 'assistant',
          content: result.revised_prompt
            ? `Here's your generated image. I refined your prompt to: "${result.revised_prompt}"`
            : 'Here\'s your generated image.',
          timestamp: Date.now(),
          imageUrl: imageDataUrl,
          metadata: { model_used: result.model_used },
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
      const errorMsg: Message = {
        role: 'assistant',
        content: 'Sorry, I couldn\'t generate that. Please try again or use a different prompt.',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, selectedModel, selectedSize]);

  const handleRegenerate = useCallback((originalPrompt: string) => {
    handleGenerate(originalPrompt);
  }, [handleGenerate]);

  const handleDownload = useCallback((imageUrl: string, promptText: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `Oxlo_VoxVision.ai-${promptText.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden" style={{ background: '#05070D' }}>

      {/* ── Subtle Background ──────────────────────────────────── */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 50% 30%, rgba(0,170,255,0.03) 0%, transparent 60%)',
      }} />

      {/* ── Content ────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative z-10 pt-24 pb-48">
        <div className="max-w-3xl mx-auto px-6 space-y-6 min-h-full flex flex-col">

          {/* ── Empty State ──────────────────────────────────────── */}
          {messages.length === 0 && !isGenerating && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center"
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(0,170,255,0.1), rgba(0,170,255,0.03))',
                    border: '1px solid rgba(0,170,255,0.15)',
                    boxShadow: '0 0 30px rgba(0,170,255,0.08)',
                  }}
                >
                  <ImagePlus className="w-9 h-9" style={{ color: '#00AAFF' }} />
                </div>
                <h2 className="text-3xl font-bold mb-3" style={{ color: '#e0f0ff', letterSpacing: '-0.02em' }}>
                  Generate Images
                </h2>
                <p className="text-sm mb-8" style={{ color: 'rgba(0,170,255,0.45)' }}>
                  Describe anything and bring it to life
                </p>

                {/* Prompt Suggestions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-lg mx-auto">
                  {PROMPT_SUGGESTIONS.slice(0, 4).map((suggestion) => (
                    <motion.button
                      key={suggestion}
                      whileHover={{ scale: 1.02, borderColor: 'rgba(0,170,255,0.3)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleGenerate(suggestion)}
                      className="text-left px-4 py-3 rounded-2xl text-[13px] leading-snug transition-all cursor-pointer"
                      style={{
                        background: 'rgba(0,170,255,0.03)',
                        border: '1px solid rgba(0,170,255,0.1)',
                        color: 'rgba(0,170,255,0.6)',
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5 inline mr-2 opacity-50" />
                      {suggestion.length > 55 ? suggestion.slice(0, 55) + '…' : suggestion}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}

          {/* ── Messages ──────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <ImageMessageBubble
                key={m.timestamp + '-' + i}
                message={m}
                onRegenerate={handleRegenerate}
                onDownload={handleDownload}
                onImageClick={setLightboxImage}
              />
            ))}
          </AnimatePresence>

          {/* ── Generation Loading State ───────────────────────── */}
          {isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-4 items-start"
            >
              <div
                className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center mt-1"
                style={{
                  background: 'linear-gradient(135deg, #00AAFF, #0088CC)',
                  boxShadow: '0 0 15px rgba(0,170,255,0.4)',
                }}
              >
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div
                className="flex-1 px-5 py-4 rounded-3xl rounded-tl-sm"
                style={{
                  background: 'rgba(0,170,255,0.04)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(0,170,255,0.1)',
                }}
              >
                {/* Shimmer Loading */}
                <div className="flex items-center gap-3 mb-3">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#00AAFF' }} />
                  <span className="text-sm font-medium" style={{ color: 'rgba(0,170,255,0.7)' }}>
                    Generating your image...
                  </span>
                </div>
                <div className="space-y-2">
                  <ShimmerBar width="100%" />
                  <ShimmerBar width="75%" />
                  <div className="mt-3 rounded-2xl overflow-hidden" style={{ aspectRatio: '1', maxWidth: '300px' }}>
                    <ShimmerBlock />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Floating Input Dock ─────────────────────────────────── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center px-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-3xl rounded-[28px] shadow-2xl"
          style={{
            background: 'rgba(5, 7, 13, 0.8)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(0,170,255,0.12)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 25px rgba(0,170,255,0.06)',
          }}
        >
          {/* Model + Size selectors */}
          <div className="flex items-center gap-2 px-5 pt-3 pb-1">
            {/* Model Picker */}
            <div ref={modelPickerRef} className="relative">
              <button
                onClick={() => { setShowModelPicker(p => !p); setShowSizePicker(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium uppercase transition-all cursor-pointer"
                style={{
                  background: 'rgba(0,170,255,0.05)',
                  border: '1px solid rgba(0,170,255,0.12)',
                  color: 'rgba(0,170,255,0.5)',
                  letterSpacing: '0.03em',
                }}
              >
                {(() => { const M = MODEL_INFO[selectedModel]; return <M.icon className="w-3 h-3" />; })()}
                {MODEL_INFO[selectedModel].label}
                <ChevronDown className="w-3 h-3" />
              </button>
              <AnimatePresence>
                {showModelPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    className="absolute bottom-full mb-2 left-0 rounded-2xl overflow-hidden shadow-xl z-50"
                    style={{
                      background: 'rgba(10, 15, 25, 0.95)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(0,170,255,0.15)',
                      minWidth: '200px',
                    }}
                  >
                    {(Object.entries(MODEL_INFO) as [ImageModel, typeof MODEL_INFO[ImageModel]][]).map(([id, info]) => (
                      <button
                        key={id}
                        onClick={() => { setSelectedModel(id); setShowModelPicker(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer"
                        style={{
                          background: selectedModel === id ? 'rgba(0,170,255,0.08)' : 'transparent',
                          color: selectedModel === id ? '#00AAFF' : 'rgba(0,170,255,0.5)',
                          borderBottom: '1px solid rgba(0,170,255,0.06)',
                        }}
                      >
                        <info.icon className="w-4 h-4" />
                        <div>
                          <div className="text-sm font-medium">{info.label}</div>
                          <div className="text-[10px] uppercase opacity-50">{info.tier}</div>
                        </div>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Size Picker */}
            <div ref={sizePickerRef} className="relative">
              <button
                onClick={() => { setShowSizePicker(p => !p); setShowModelPicker(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium uppercase transition-all cursor-pointer"
                style={{
                  background: 'rgba(0,170,255,0.05)',
                  border: '1px solid rgba(0,170,255,0.12)',
                  color: 'rgba(0,170,255,0.5)',
                  letterSpacing: '0.03em',
                }}
              >
                {SIZE_LABELS[selectedSize]}
                <ChevronDown className="w-3 h-3" />
              </button>
              <AnimatePresence>
                {showSizePicker && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 5, scale: 0.95 }}
                    className="absolute bottom-full mb-2 left-0 rounded-2xl overflow-hidden shadow-xl z-50"
                    style={{
                      background: 'rgba(10, 15, 25, 0.95)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(0,170,255,0.15)',
                      minWidth: '160px',
                    }}
                  >
                    {(Object.entries(SIZE_LABELS) as [ImageSize, string][]).map(([size, label]) => (
                      <button
                        key={size}
                        onClick={() => { setSelectedSize(size); setShowSizePicker(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer"
                        style={{
                          background: selectedSize === size ? 'rgba(0,170,255,0.08)' : 'transparent',
                          color: selectedSize === size ? '#00AAFF' : 'rgba(0,170,255,0.5)',
                          borderBottom: '1px solid rgba(0,170,255,0.06)',
                        }}
                      >
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-[10px] opacity-40 ml-auto">{size}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Input Row */}
          <div className="flex items-end gap-3 px-4 pb-3 pt-1">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Describe the image you want to create..."
              rows={1}
              disabled={isGenerating}
              className="flex-1 resize-none bg-transparent outline-none text-[15px] leading-relaxed py-2.5 px-2 placeholder:text-[rgba(0,170,255,0.25)] disabled:opacity-40"
              style={{ color: '#e0f0ff', maxHeight: '120px' }}
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleGenerate()}
              disabled={!prompt.trim() || isGenerating}
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 mb-0.5"
              style={{
                background: prompt.trim() && !isGenerating
                  ? 'linear-gradient(135deg, #00AAFF, #0088CC)'
                  : 'rgba(0,170,255,0.06)',
                boxShadow: prompt.trim() && !isGenerating
                  ? '0 0 20px rgba(0,170,255,0.3)'
                  : 'none',
              }}
            >
              {isGenerating ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'rgba(0,170,255,0.5)' }} />
              ) : (
                <Send className="w-5 h-5 text-white" />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────────────────── */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)' }}
            onClick={() => setLightboxImage(null)}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.2 }}
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={lightboxImage}
                alt="Generated image fullscreen"
                className="rounded-2xl shadow-2xl max-w-full max-h-[85vh] object-contain"
                style={{ border: '1px solid rgba(0,170,255,0.2)' }}
              />
              <button
                onClick={() => setLightboxImage(null)}
                className="absolute -top-3 -right-3 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                style={{
                  background: 'rgba(5,7,13,0.9)',
                  border: '1px solid rgba(0,170,255,0.2)',
                  color: '#00AAFF',
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ── Image Message Bubble ────────────────────────────────────────────────

function ImageMessageBubble({
  message,
  onRegenerate,
  onDownload,
  onImageClick,
}: {
  message: Message;
  onRegenerate: (prompt: string) => void;
  onDownload: (imageUrl: string, prompt: string) => void;
  onImageClick: (url: string) => void;
}) {
  const isUser = message.role === 'user';
  const isCompoundText = message.metadata?.intent === 'compound_text';

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex gap-4 items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center mt-1"
        style={{
          background: isUser
            ? 'rgba(0, 170, 255, 0.06)'
            : 'linear-gradient(135deg, #00AAFF, #0088CC)',
          border: isUser ? '1px solid rgba(0, 170, 255, 0.15)' : 'none',
          boxShadow: isUser ? 'none' : '0 0 15px rgba(0,170,255,0.3)',
        }}
      >
        {isUser
          ? <User className="w-4 h-4" style={{ color: 'rgba(0, 170, 255, 0.6)' }} />
          : <Bot className="w-5 h-5 text-white" />}
      </div>

      {/* Content */}
      <div className={`max-w-[85%] ${isUser ? 'text-right' : 'text-left'}`}>
        {isCompoundText ? (
          <StructuredTextRendererImage text={message.content} />
        ) : (
          <div
            className={`px-5 py-4 text-[15px] leading-relaxed shadow-lg ${
              isUser ? 'rounded-3xl rounded-tr-sm' : 'rounded-3xl rounded-tl-sm'
            }`}
            style={{
              background: isUser ? 'rgba(0, 170, 255, 0.04)' : 'rgba(0, 170, 255, 0.06)',
              backdropFilter: 'blur(20px)',
              border: `1px solid rgba(0, 170, 255, ${isUser ? '0.08' : '0.15'})`,
              color: '#e0f0ff',
            }}
          >
            {message.content}
          </div>
        )}

        {/* Generated Image */}
        {message.imageUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-3 relative group"
          >
            <div
              className="rounded-2xl overflow-hidden inline-block cursor-pointer"
              style={{
                border: '1px solid rgba(0,170,255,0.15)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.4), 0 0 20px rgba(0,170,255,0.06)',
                maxWidth: '400px',
              }}
              onClick={() => onImageClick(message.imageUrl!)}
            >
              <img
                src={message.imageUrl}
                alt="Generated image"
                className="w-full h-auto block"
                style={{ maxHeight: '400px', objectFit: 'contain' }}
              />
              {/* Hover overlay */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              >
                <Maximize2 className="w-6 h-6 text-white drop-shadow-lg" />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onDownload(message.imageUrl!, message.content)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium cursor-pointer"
                style={{
                  background: 'rgba(0,170,255,0.05)',
                  border: '1px solid rgba(0,170,255,0.12)',
                  color: 'rgba(0,170,255,0.6)',
                }}
              >
                <Download className="w-3 h-3" />
                Download
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  const userPrompt = message.content.includes('refined your prompt')
                    ? message.content.match(/"([^"]+)"/)?.[1] || ''
                    : '';
                  onRegenerate(userPrompt || 'regenerate the last image');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium cursor-pointer"
                style={{
                  background: 'rgba(0,170,255,0.05)',
                  border: '1px solid rgba(0,170,255,0.12)',
                  color: 'rgba(0,170,255,0.6)',
                }}
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate
              </motion.button>
              {message.metadata?.model_used && (
                <span className="text-[10px] font-medium uppercase px-2 py-1 rounded-full"
                  style={{
                    color: 'rgba(0,170,255,0.3)',
                    background: 'rgba(0,170,255,0.03)',
                    border: '1px solid rgba(0,170,255,0.06)',
                    letterSpacing: '0.03em',
                  }}
                >
                  {message.metadata.model_used}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}


// ── Structured Text Renderer for ImageMode ──────────────────────────────

function StructuredTextRendererImage({ text }: { text: string }) {
  const sections = parseStructuredTextImage(text);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-3xl rounded-tl-sm overflow-hidden shadow-xl"
      style={{
        background: 'rgba(0, 170, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0, 170, 255, 0.12)',
      }}
    >
      {sections.map((section, i) => (
        <div
          key={i}
          className="px-6 py-4"
          style={{
            borderBottom: i < sections.length - 1 ? '1px solid rgba(0,170,255,0.06)' : 'none',
          }}
        >
          {section.header && (
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-lg">{section.emoji}</span>
              <h3 className="text-[15px] font-bold" style={{ color: '#00AAFF' }}>
                {section.header}
              </h3>
            </div>
          )}
          <div className="text-[14px] leading-relaxed" style={{ color: '#c8dff0' }}>
            {section.lines.map((line, li) => {
              const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
              if (numberedMatch) {
                return (
                  <div key={li} className="flex gap-3 mb-2.5 items-start">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold mt-0.5"
                      style={{
                        background: 'rgba(0,170,255,0.1)',
                        color: '#00AAFF',
                        border: '1px solid rgba(0,170,255,0.2)',
                      }}
                    >
                      {numberedMatch[1]}
                    </span>
                    <span className="flex-1">{renderBoldTextImage(numberedMatch[2])}</span>
                  </div>
                );
              }

              const bulletMatch = line.match(/^[-•]\s+(.+)/);
              if (bulletMatch) {
                const parts = bulletMatch[1].split(/\s*[—–]\s*/);
                return (
                  <div key={li} className="flex gap-3 mb-2 items-start pl-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0 mt-2"
                      style={{ background: '#00AAFF', opacity: 0.6 }}
                    />
                    <span className="flex-1">
                      {parts.length > 1 ? (
                        <>
                          <span style={{ color: '#e0f0ff' }}>{renderBoldTextImage(parts[0])}</span>
                          <span style={{ color: 'rgba(0,170,255,0.5)' }}> — </span>
                          <span style={{ color: 'rgba(0,170,255,0.8)' }}>{parts.slice(1).join(' — ')}</span>
                        </>
                      ) : (
                        renderBoldTextImage(bulletMatch[1])
                      )}
                    </span>
                  </div>
                );
              }

              if (line.trim()) {
                return <p key={li} className="mb-2">{renderBoldTextImage(line)}</p>;
              }
              return null;
            })}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function parseStructuredTextImage(text: string): Array<{
  emoji: string;
  header: string;
  lines: string[];
}> {
  const lines = text.split('\n');
  const sections: Array<{ emoji: string; header: string; lines: string[] }> = [];
  let current: { emoji: string; header: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^([\p{Emoji_Presentation}\p{Emoji}\u200d]+)\s*\*\*(.+?)\*\*/u);
    if (headerMatch) {
      if (current) sections.push(current);
      current = {
        emoji: headerMatch[1].trim(),
        header: headerMatch[2].trim(),
        lines: [],
      };
      const afterHeader = line.replace(headerMatch[0], '').trim();
      if (afterHeader) current.lines.push(afterHeader);
    } else if (current) {
      current.lines.push(line);
    } else {
      if (line.trim()) {
        if (!current) current = { emoji: '', header: '', lines: [] };
        current.lines.push(line);
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function renderBoldTextImage(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: '#e0f0ff', fontWeight: 600 }}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}


// ── Shimmer Loading Components ──────────────────────────────────────────

function ShimmerBar({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded-full overflow-hidden"
      style={{ width, background: 'rgba(0,170,255,0.04)' }}
    >
      <motion.div
        className="h-full w-1/2 rounded-full"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(0,170,255,0.08), transparent)' }}
        animate={{ x: ['-100%', '300%'] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
      />
    </div>
  );
}

function ShimmerBlock() {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden" style={{ background: 'rgba(0,170,255,0.03)' }}>
      <motion.div
        className="w-full h-full"
        style={{
          background: 'linear-gradient(110deg, transparent 30%, rgba(0,170,255,0.06) 50%, transparent 70%)',
        }}
        animate={{ x: ['-100%', '100%'] }}
        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
      />
    </div>
  );
}
