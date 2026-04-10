import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Square, Loader2, User, Bot, RotateCcw,
  ImagePlus, Send, Download, RefreshCw, Maximize2, X,
  ChevronDown, Zap, Crown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { transcribeAudio, streamChat, speakText } from '../api/voice';
import { generateImage } from '../api/image';
import { generateCompound, isCompoundPrompt } from '../api/compound';
import { cleanResponse } from '../utils/textCleaners';
import WaveformBars from './WaveformBars';
import MiniAIAssistant from './MiniAIAssistant';
import type { Message } from '../types';

type Phase = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking' | 'generating_image';

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

// Each suggestion carries a mode tag so we can style it differently
const PROMPT_SUGGESTIONS: { text: string; mode: 'image' | 'voice'; label: string }[] = [
  { text: 'Say: Create a futuristic city at night', mode: 'voice', label: 'Say' },
  { text: 'A Japanese garden in spring', mode: 'image', label: 'Type or say' },
  { text: 'Say: astronaut playing guitar on Mars', mode: 'voice', label: 'Say' },
];

export default function VoiceMode() {
  const { state: recState, audioBlob, start, stop, reset } = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>('idle');
  // Pre-loaded greeting bubble — shown immediately when the session starts
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m Oxlo VoxVision AI \u2014 your smart voice and image assistant. How can I help you today? \ud83d\ude0a',
      timestamp: Date.now(),
    },
  ]);
  const [streamingText, setStreamingText] = useState('');
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [_audioLevel, setAudioLevel] = useState(0);  // used by VAD for orb reactivity
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const vadRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; raf: number } | null>(null);

  // ── Detected language state (for TTS routing and LLM prompt) ─────────
  const [detectedLanguage, setDetectedLanguage] = useState<string>('en');
  const [detectedLanguageName, setDetectedLanguageName] = useState<string>('English');
  const [sttEngine, setSttEngine] = useState<string | null>(null);  // "sarvam" | "groq"

  // ── Image generation state ─────────────────────────────────
  const [showImagePanel, setShowImagePanel] = useState(false);
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ImageModel>('oxlo-image-pro');
  const [selectedSize, setSelectedSize] = useState<ImageSize>('1024x1024');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const sizePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText]);

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

  // ── Audio analyser: drives the orb reactivity ────────────
  const startVAD = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const normalized = Math.min(1, avg / 128);
        setAudioLevel(normalized);
        vadRef.current!.raf = requestAnimationFrame(tick);
      };
      vadRef.current = { ctx, analyser, raf: requestAnimationFrame(tick) };
      setAnalyserNode(analyser);
    } catch {}
  }, []);

  const stopVAD = useCallback(() => {
    if (vadRef.current) {
      cancelAnimationFrame(vadRef.current.raf);
      vadRef.current.ctx.close().catch(() => {});
      vadRef.current = null;
    }
    setAudioLevel(0);
    setAnalyserNode(null);
  }, []);

  useEffect(() => () => stopVAD(), [stopVAD]);

  const addMsg = (role: 'user' | 'assistant', content: string, extra?: Partial<Message>) => {
    const msg: Message = { role, content, timestamp: Date.now(), ...extra };
    setMessages(p => [...p, msg]);
    historyRef.current.push({ role, content });
    if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
  };

  // ── Voice flow (existing) ──────────────────────────────────
  useEffect(() => {
    if (!audioBlob) return;
    stopVAD();

    (async () => {
      try {
        setPhase('transcribing');
        const result = await transcribeAudio(audioBlob);

        if (!result.text?.trim() && !result.cleaned_text?.trim()) {
          setPhase('idle'); reset(); return;
        }

        const userText = result.cleaned_text || result.text;
        addMsg('user', userText);

        // ── Capture detected language & STT engine for this turn ─────────────
        const lang = result.detected_language || 'en';
        const langName = result.language_name || 'English';
        setDetectedLanguage(lang);
        setDetectedLanguageName(langName);
        if (result.engine) setSttEngine(result.engine);
        if (lang !== 'en') {
          toast(`🌐 ${langName} detected`, { duration: 2000, style: { background: 'rgba(0,100,200,0.85)', color: '#fff', fontSize: '13px' } });
        }

        // ── Check if this is a COMPOUND request (image + explained text) ──
        if (result.intent === 'compound') {
          setPhase('generating_image');
          try {
            const compoundResult = await generateCompound(userText);
            const imageDataUrl = `data:image/png;base64,${compoundResult.image_b64}`;

            // Message 1: Image
            const imageMsg: Message = {
              role: 'assistant',
              content: compoundResult.voice_summary,
              timestamp: Date.now(),
              imageUrl: imageDataUrl,
              metadata: { model_used: compoundResult.image_model_used },
            };
            setMessages(p => [...p, imageMsg]);
            historyRef.current.push({ role: 'assistant', content: '[Generated an image]' });
            if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);

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
            setMessages(p => [...p, textMsg]);
            historyRef.current.push({ role: 'assistant', content: `[Structured info about ${compoundResult.title}]` });
            if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);

            // Voice: speak short summary only
            setPhase('speaking');
            await speakText(compoundResult.voice_summary, lang);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Compound generation failed');
            addMsg('assistant', 'Sorry, I couldn\'t generate that. Please try again.');
          }
          setPhase('idle');
          reset();
          return;
        }

        // ── Check if this is a single image generation request ───────
        if (result.intent === 'image_generation') {
          setPhase('generating_image');
          try {
            const imgResult = await generateImage(userText);
            const imageDataUrl = `data:image/png;base64,${imgResult.image_b64}`;
            const assistantMsg: Message = {
              role: 'assistant',
              content: 'Here\'s the image I generated for you.',
              timestamp: Date.now(),
              imageUrl: imageDataUrl,
              metadata: { model_used: imgResult.model_used },
            };
            setMessages(p => [...p, assistantMsg]);
            historyRef.current.push({ role: 'assistant', content: '[Generated an image]' });
            if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);

            setPhase('speaking');
            await speakText('Here is the image I generated for you.', 'en');
          } catch (imgErr) {
            toast.error(imgErr instanceof Error ? imgErr.message : 'Image generation failed');
            addMsg('assistant', 'Sorry, I couldn\'t generate that image. Please try again.');
          }
          setPhase('idle');
          reset();
          return;
        }

        // ── Normal voice chat flow ────────────────────────────────
        setPhase('thinking');
        let full = '';
        setStreamingText('');
        for await (const token of streamChat(
          userText,
          historyRef.current.slice(0, -1),
          { mode: 'voice', input_type: 'speech', language: lang }
        )) {
          full += token;
          setStreamingText(cleanResponse(full));
        }

        // ── Completeness check — catch truncated streaming responses ──
        // If the stream produced a very short, header-only, or obviously
        // incomplete response, retry via the validated /chat endpoint
        // which has post-generation quality gate + auto-retry logic.
        const isIncomplete = (text: string): boolean => {
          const trimmed = text.trim();
          if (trimmed.length < 80) return true;
          // Has a section header (Ingredients, Steps, etc.) but no numbered steps
          const hasHeader = /ingredients|materials|overview|step/i.test(trimmed);
          const hasSteps = /(?:step\s*\d|^\d+\.|ಹಂತ\s*\d|படி\s*\d|దశ\s*\d|चरण\s*\d)/mi.test(trimmed);
          if (hasHeader && !hasSteps && trimmed.length < 300) return true;
          return false;
        };

        if (isIncomplete(full)) {
          console.warn('[VoiceMode] Streaming response incomplete, retrying via validated endpoint...');
          setStreamingText('Generating complete response...');
          try {
            const { chatFullValidated } = await import('../api/voice');
            const validated = await chatFullValidated(
              userText,
              historyRef.current.slice(0, -1),
              { mode: 'voice', language: lang }
            );
            full = cleanResponse(validated.text);
            setStreamingText(full);
          } catch (retryErr) {
            console.error('[VoiceMode] Validated retry also failed:', retryErr);
            // Keep the incomplete streaming result — better than nothing
          }
        }

        addMsg('assistant', cleanResponse(full));
        setStreamingText('');

        setPhase('speaking');
        await speakText(full, lang);
        setPhase('idle');
        reset();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong');
        setPhase('idle');
        reset();
      }
    })();
  }, [audioBlob]);

  // ── Text-based image generation ────────────────────────────
  const handleImageGenerate = useCallback(async (inputPrompt?: string) => {
    const finalPrompt = inputPrompt || imagePrompt.trim();
    if (!finalPrompt || isGeneratingImage) return;

    // Add user message
    addMsg('user', finalPrompt);
    setImagePrompt('');
    setIsGeneratingImage(true);

    if (imageInputRef.current) {
      imageInputRef.current.style.height = 'auto';
    }

    try {
      // ── Check for compound intent on the frontend ─────────────
      if (isCompoundPrompt(finalPrompt)) {
        const compoundResult = await generateCompound(finalPrompt, selectedModel, selectedSize);
        const imageDataUrl = `data:image/png;base64,${compoundResult.image_b64}`;

        // Message 1: Image + voice summary
        const imageMsg: Message = {
          role: 'assistant',
          content: compoundResult.voice_summary,
          timestamp: Date.now(),
          imageUrl: imageDataUrl,
          metadata: { model_used: compoundResult.image_model_used },
        };
        setMessages(prev => [...prev, imageMsg]);
        historyRef.current.push({ role: 'assistant', content: '[Generated an image]' });
        if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);

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
        historyRef.current.push({ role: 'assistant', content: `[Structured info about ${compoundResult.title}]` });
        if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
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
        historyRef.current.push({ role: 'assistant', content: '[Generated an image]' });
        if (historyRef.current.length > 10) historyRef.current = historyRef.current.slice(-10);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
      addMsg('assistant', 'Sorry, I couldn\'t generate that. Please try again or use a different prompt.');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [imagePrompt, isGeneratingImage, selectedModel, selectedSize]);

  const handleImageRegenerate = useCallback((originalPrompt: string) => {
    handleImageGenerate(originalPrompt);
  }, [handleImageGenerate]);

  const handleDownload = useCallback((imageUrl: string, promptText: string) => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `Oxlo_VoxVision.ai-${promptText.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleImageKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleImageGenerate();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setImagePrompt(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleMicClick = async () => {
    if (recState === 'recording') {
      stop(); stopVAD();
      return;
    }
    if (phase !== 'idle') return;
    setPhase('recording');
    const stream = await start();
    if (stream) startVAD(stream);
  };

  const isBusy = phase === 'transcribing' || phase === 'thinking' || phase === 'speaking' || phase === 'generating_image';
  const isAnythingBusy = isBusy || isGeneratingImage;

  // Dynamic status copy — reinforce image-gen capability when relevant
  const statusText = recState === 'recording' ? 'Listening...'
    : phase === 'transcribing' ? 'Processing your voice...'
    : phase === 'thinking' ? `Thinking${detectedLanguage !== 'en' ? ` in ${detectedLanguageName}` : ''}...`
    : phase === 'generating_image' ? '🖼️ Generating image...'
    : phase === 'speaking' ? 'Speaking...'
    : isGeneratingImage ? '🖼️ Generating image...'
    : 'Ready';

  // Language badge: shown when non-English language is active
  const LANG_FLAGS: Record<string, string> = {
    kn: '🇮🇳', ta: '🇮🇳', te: '🇮🇳', hi: '🇮🇳',
    es: '🇪🇸', fr: '🇫🇷', ja: '🇯🇵', en: '',
  };
  const langBadge = detectedLanguage !== 'en'
    ? { flag: LANG_FLAGS[detectedLanguage] || '🌐', name: detectedLanguageName }
    : null;

  return (
    <div className="h-full flex flex-col relative overflow-hidden" style={{ background: '#05070D' }}>

      {/* ── Looping Video Background ──────────────────────────── */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover pointer-events-none z-0"
        style={{ opacity: 0.85, mixBlendMode: 'screen' }}
        src="https://videos.pexels.com/video-files/3129957/3129957-hd_1920_1080_25fps.mp4"
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 z-[1] pointer-events-none" style={{
        background: 'radial-gradient(circle at center 40%, transparent 30%, rgba(5,7,13,0.7) 70%, rgba(5,7,13,0.95) 100%)',
      }} />

      {/* ── Content Layer ──────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative z-10 pt-10 pb-48">
        <div className="max-w-3xl mx-auto px-6 space-y-6 min-h-full flex flex-col">
          
          {/* ── Greeting & Status ─────────────────────────────────── */}
          <div className={`flex flex-col items-center ${messages.length <= 1 ? 'flex-1 justify-center mt-16' : 'py-6'}`}>
            
            <motion.div
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              {messages.length <= 1 && phase === 'idle' && !isGeneratingImage ? (
                <>
                  <h2 className="text-5xl font-bold" style={{ color: '#00AAFF', letterSpacing: '-0.02em', lineHeight: '1.2' }}>
                    What can I help with?
                  </h2>
                </>
              ) : (
                <>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={isGeneratingImage ? 'generating' : statusText}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="text-base font-semibold uppercase"
                    style={{ color: 'rgba(0, 170, 255, 0.7)', letterSpacing: '0.04em' }}
                  >
                    {isGeneratingImage ? 'Generating Image...' : statusText}
                  </motion.p>
                </AnimatePresence>

                {/* ── Language badge — shown when non-English language detected */}
                <AnimatePresence>
                  {langBadge && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8, y: 4 }}
                      className="flex items-center gap-2 mt-2"
                    >
                      {/* Language pill */}
                      <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium"
                        style={{
                          background: 'rgba(0, 130, 255, 0.08)',
                          border: '1px solid rgba(0, 170, 255, 0.2)',
                          color: 'rgba(0, 170, 255, 0.85)',
                          backdropFilter: 'blur(8px)',
                        }}
                      >
                        <span>{langBadge.flag}</span>
                        <span>{langBadge.name}</span>
                      </span>
                      {/* STT engine pill */}
                      {sttEngine && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase"
                          style={{
                            background: sttEngine === 'sarvam' ? 'rgba(0,200,120,0.08)' : 'rgba(255,170,0,0.08)',
                            border: sttEngine === 'sarvam' ? '1px solid rgba(0,200,120,0.25)' : '1px solid rgba(255,170,0,0.25)',
                            color: sttEngine === 'sarvam' ? 'rgba(0,220,140,0.9)' : 'rgba(255,185,0,0.9)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {sttEngine === 'sarvam' ? '✦ Sarvam' : '◈ Whisper'}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
                </>
              )}


            </motion.div>
          </div>

          {/* ── Messages ─────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <MessageBubble
                key={m.timestamp + '-' + i}
                message={m}
                onRegenerate={handleImageRegenerate}
                onDownload={handleDownload}
                onImageClick={setLightboxImage}
              />
            ))}
            
            {streamingText && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4 items-start"
              >
                <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-1"
                  style={{ background: 'linear-gradient(135deg, #00AAFF, #0088CC)', boxShadow: '0 0 15px rgba(0,170,255,0.4)' }}
                >
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 px-5 py-4 rounded-3xl rounded-tl-sm text-[15px] leading-relaxed shadow-xl"
                  style={{
                    background: 'rgba(0, 170, 255, 0.04)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(0, 170, 255, 0.1)',
                    color: '#e0f0ff',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {streamingText}
                  <motion.span
                    className="inline-block w-1.5 h-4 ml-1 align-middle rounded-full"
                    style={{ background: '#00AAFF' }}
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Image Generation Loading State ───────────────────── */}
          {isGeneratingImage && (
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

      {/* ── Floating Control Dock ───────────────────────────────── */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex flex-col items-center px-4 pointer-events-none gap-3">
        
        {/* ── Image Generation Input Panel ─────────────────────── */}
        <AnimatePresence>
          {showImagePanel && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
              className="pointer-events-auto w-full max-w-3xl rounded-[28px] shadow-2xl"
              style={{
                background: 'rgba(5, 7, 13, 0.85)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(0,170,255,0.12)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 25px rgba(0,170,255,0.06)',
              }}
            >
              {/* Close button */}
              <div className="flex items-center justify-between px-5 pt-3 pb-0">
                <div className="flex items-center gap-2">
                  <ImagePlus className="w-4 h-4" style={{ color: 'rgba(0,170,255,0.5)' }} />
                  <span className="text-[11px] font-medium uppercase" style={{ color: 'rgba(0,170,255,0.4)', letterSpacing: '0.04em' }}>
                    Image Generation
                  </span>
                </div>
                <button
                  onClick={() => setShowImagePanel(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                  style={{ color: 'rgba(0,170,255,0.4)' }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Model + Size selectors */}
              <div className="flex items-center gap-2 px-5 pt-2 pb-1">
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
                  ref={imageInputRef}
                  value={imagePrompt}
                  onChange={handleTextareaInput}
                  onKeyDown={handleImageKeyDown}
                  placeholder="Type or say: Create an image of a sunset over mountains..."
                  rows={1}
                  disabled={isGeneratingImage}
                  className="flex-1 resize-none bg-transparent outline-none text-[15px] leading-relaxed py-2.5 px-2 placeholder:text-[rgba(0,170,255,0.25)] disabled:opacity-40"
                  style={{ color: '#e0f0ff', maxHeight: '120px' }}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleImageGenerate()}
                  disabled={!imagePrompt.trim() || isGeneratingImage}
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 mb-0.5"
                  style={{
                    background: imagePrompt.trim() && !isGeneratingImage
                      ? 'linear-gradient(135deg, #00AAFF, #0088CC)'
                      : 'rgba(0,170,255,0.06)',
                    boxShadow: imagePrompt.trim() && !isGeneratingImage
                      ? '0 0 20px rgba(0,170,255,0.3)'
                      : 'none',
                  }}
                >
                  {isGeneratingImage ? (
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'rgba(0,170,255,0.5)' }} />
                  ) : (
                    <Send className="w-5 h-5 text-white" />
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Voice Controls + Image Toggle ─────────────────────── */}
        <div className="pointer-events-auto flex items-center gap-4 p-3 rounded-[32px] shadow-xl"
          style={{
            background: 'rgba(5, 7, 13, 0.7)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(0, 170, 255, 0.1)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 20px rgba(0,170,255,0.05)',
          }}
        >
          
          {/* Clear */}
          <div className="w-12 h-12 flex items-center justify-center">
            {messages.length > 1 && phase === 'idle' && !isGeneratingImage && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={{ scale: 1.1, boxShadow: '0 0 12px rgba(0,170,255,0.2)' }}
                whileTap={{ scale: 0.9 }}
                onClick={() => { setMessages([{
                  role: 'assistant',
                  content: 'Hi! I\'m Oxlo VoxVision AI \u2014 your smart voice and image assistant. How can I help you today? \ud83d\ude0a',
                  timestamp: Date.now(),
                }]); historyRef.current = []; }}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                style={{ background: 'rgba(0,170,255,0.05)', color: 'rgba(0,170,255,0.5)' }}
              >
                <RotateCcw className="w-4 h-4" />
              </motion.button>
            )}
          </div>

          {/* Image Toggle Button */}
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setShowImagePanel(p => !p)}
            className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all"
            style={{
              background: showImagePanel ? 'rgba(0,170,255,0.12)' : 'rgba(0,170,255,0.05)',
              border: showImagePanel ? '1px solid rgba(0,170,255,0.3)' : '1px solid rgba(0,170,255,0.1)',
              color: showImagePanel ? '#00AAFF' : 'rgba(0,170,255,0.5)',
              boxShadow: showImagePanel ? '0 0 15px rgba(0,170,255,0.15)' : 'none',
            }}
          >
            <ImagePlus className="w-5 h-5" />
          </motion.button>

          {/* Mic Button */}
          <motion.button
            onClick={handleMicClick}
            disabled={isBusy || isGeneratingImage}
            className="group relative w-16 h-16 rounded-full flex items-center justify-center overflow-hidden cursor-pointer disabled:cursor-not-allowed"
            whileTap={{ scale: 0.95 }}
          >
            <div className="absolute inset-0 transition-all duration-500 rounded-full"
              style={{
                background: recState === 'recording'
                  ? 'linear-gradient(135deg, #FF8C00, #E06000)'
                  : isAnythingBusy
                    ? 'rgba(0,170,255,0.05)'
                    : 'linear-gradient(135deg, #00AAFF, #0088CC)',
                boxShadow: recState === 'recording'
                  ? '0 0 30px rgba(255,140,0,0.35)'
                  : isAnythingBusy
                    ? 'none'
                    : '0 0 30px rgba(0,170,255,0.3)',
              }}
            />
            
            {recState === 'recording' && (
               <motion.div
                 className="absolute inset-0 rounded-full"
                 style={{ border: '2px solid rgba(255,180,60,0.6)' }}
                 animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
                 transition={{ repeat: Infinity, duration: 1 }}
               />
            )}
            
            {phase === 'idle' && !isGeneratingImage && recState !== 'recording' && (
              <>
                 <motion.div
                   className="absolute inset-0 rounded-full"
                   style={{ background: 'rgba(0,170,255,0.25)' }}
                   animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                   transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                 />
                 <motion.div
                   className="absolute inset-0 rounded-full"
                   style={{ border: '2px solid rgba(0,170,255,0.8)' }}
                   animate={{ scale: [1, 1.4], opacity: [0.8, 0] }}
                   transition={{ repeat: Infinity, duration: 2, ease: "easeOut", delay: 0.5 }}
                 />
              </>
            )}
            
            <div className="relative z-10">
              {isAnythingBusy ? (
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'rgba(0,170,255,0.6)' }} />
              ) : recState === 'recording' ? (
                <Square className="w-5 h-5 text-white" />
              ) : (
                <Mic className="w-6 h-6 text-white drop-shadow-md group-hover:scale-110 transition-transform duration-300" />
              )}
            </div>
            
            <div className="absolute inset-0 rounded-full border border-white/10 select-none pointer-events-none" />
          </motion.button>

          {/* Waveform / Status */}
          <div className="min-w-[200px] text-center mr-2 flex justify-center">
            <AnimatePresence mode="wait">
              {recState === 'recording' ? (
                <motion.div
                  key="waveform"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <WaveformBars analyser={analyserNode} />
                </motion.div>
              ) : (
                <motion.p
                  key={isGeneratingImage ? 'img-gen' : phase}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="text-xs font-medium uppercase"
                  style={{ color: 'rgba(0, 170, 255, 0.7)', fontSize: '11px', letterSpacing: '0.04em' }}
                >
                  {isGeneratingImage ? 'Generating image...'
                    : phase === 'transcribing' ? 'Processing...'
                    : phase === 'thinking' ? 'Thinking...'
                    : phase === 'generating_image' ? 'Generating image...'
                    : phase === 'speaking' ? 'Speaking...'
                    : ''}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>


      </div>

      <MiniAIAssistant phase={phase} isGeneratingImage={isGeneratingImage} hasMessages={messages.length > 0} />

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

// ── Message Bubble (enhanced with image + compound support) ──────────

function MessageBubble({
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
          // ── Structured text rendering for compound responses ─────
          <StructuredTextRenderer text={message.content} />
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
            {isUser ? message.content : <FormattedText text={message.content} />}
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


// ── Structured Text Renderer — premium styled sections ───────────────────

function StructuredTextRenderer({ text }: { text: string }) {
  /**
   * Parse the structured text into typed sections.
   * Expects emoji-prefixed bold headers like: 📌 **Title**
   * Content follows until the next section header.
   */
  const sections = parseStructuredText(text);

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
          {/* Section Header */}
          {section.header && (
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-lg">{section.emoji}</span>
              <h3 className="text-[15px] font-bold" style={{ color: '#00AAFF' }}>
                {section.header}
              </h3>
            </div>
          )}

          {/* Section Content */}
          <div className="text-[14px] leading-relaxed" style={{ color: '#c8dff0' }}>
            {section.lines.map((line, li) => {
              // Numbered steps
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
                    <span className="flex-1">{renderBoldText(numberedMatch[2])}</span>
                  </div>
                );
              }

              // Bullet points (- Item — quantity)
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
                          <span style={{ color: '#e0f0ff' }}>{renderBoldText(parts[0])}</span>
                          <span style={{ color: 'rgba(0,170,255,0.5)' }}> — </span>
                          <span style={{ color: 'rgba(0,170,255,0.8)' }}>{parts.slice(1).join(' — ')}</span>
                        </>
                      ) : (
                        renderBoldText(bulletMatch[1])
                      )}
                    </span>
                  </div>
                );
              }

              // Regular text
              if (line.trim()) {
                return (
                  <p key={li} className="mb-2">
                    {renderBoldText(line)}
                  </p>
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}
    </motion.div>
  );
}


/** Parse structured text into sections by emoji + bold headers */
function parseStructuredText(text: string): Array<{
  emoji: string;
  header: string;
  lines: string[];
}> {
  const lines = text.split('\n');
  const sections: Array<{ emoji: string; header: string; lines: string[] }> = [];
  let current: { emoji: string; header: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match lines like: 📌 **Title** or 🧂 **Ingredients**
    const headerMatch = line.match(/^([\p{Emoji_Presentation}\p{Emoji}\u200d]+)\s*\*\*(.+?)\*\*/u);
    if (headerMatch) {
      if (current) sections.push(current);
      current = {
        emoji: headerMatch[1].trim(),
        header: headerMatch[2].trim(),
        lines: [],
      };
      // Check if there's content after the header on the same line
      const afterHeader = line.replace(headerMatch[0], '').trim();
      if (afterHeader) current.lines.push(afterHeader);
    } else if (current) {
      current.lines.push(line);
    } else {
      // Content before any header — create an untitled section
      if (line.trim()) {
        if (!current) {
          current = { emoji: '', header: '', lines: [] };
        }
        current.lines.push(line);
      }
    }
  }
  if (current) sections.push(current);

  return sections;
}

/** Render **bold** text within a string */
function renderBoldText(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: '#e0f0ff', fontWeight: 600 }}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}


// ── FormattedText — Renders LLM output with proper structure ─────────────
// Handles: section headers, bullet lists, numbered steps, plain paragraphs.
// Preserves newlines and applies visual hierarchy for readable output.

function FormattedText({ text }: { text: string }) {
  if (!text) return null;

  // Clean markdown artifacts before rendering
  const cleanedText = cleanResponse(text);
  const lines = cleanedText.split('\n');

  return (
    <div className="formatted-response" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();

        // Skip empty lines — render as spacing
        if (!trimmed) {
          return <div key={i} style={{ height: '8px' }} />;
        }

        // ── Section header: "Ingredients:", "Steps:", "ಪದಾರ್ಥಗಳು:", etc.
        const isHeader = /^(ingredients|steps|step-by-step|instructions|tips|variations|materials|tools|ಪದಾರ್ಥಗಳು|ಹಂತಗಳು|பொருட்கள்|படிகள்|పదార్థాలు|దశలు|सामग्री|चरण|विधि)[:\s]*$/i.test(trimmed)
          || /^(ingredients|steps|step-by-step|instructions|tips|variations|materials|tools|ಪದಾರ್ಥಗಳು|ಹಂತಗಳು|பொருட்கள்|படிகள்|పదార్థాలు|దశలు|सामग्री|चरण|विधि)\s*:/i.test(trimmed);

        if (isHeader) {
          return (
            <div key={i} style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#00AAFF',
              marginTop: i > 0 ? '12px' : '4px',
              marginBottom: '4px',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}>
              {trimmed}
            </div>
          );
        }

        // ── Bullet point: "• item" or "- item"
        const bulletMatch = trimmed.match(/^[•\-\*]\s+(.+)/);
        if (bulletMatch) {
          return (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              paddingLeft: '8px',
              lineHeight: '1.6',
            }}>
              <span style={{ color: '#00AAFF', fontSize: '14px', marginTop: '2px', flexShrink: 0 }}>•</span>
              <span style={{ color: '#e0f0ff' }}>{bulletMatch[1]}</span>
            </div>
          );
        }

        // ── Numbered step: "1. First step" or "Step 1: First step"
        const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
        const stepMatch = !numberedMatch ? trimmed.match(/^(?:Step|ಹಂತ|படி|దశ|चरण)\s*(\d+)[:.]\s*(.+)/i) : null;
        const stepNum = numberedMatch?.[1] || stepMatch?.[1];
        const stepText = numberedMatch?.[2] || stepMatch?.[2];

        if (stepNum && stepText) {
          return (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              paddingLeft: '4px',
              marginTop: '4px',
              lineHeight: '1.6',
            }}>
              <span style={{
                color: '#00AAFF',
                fontWeight: 700,
                fontSize: '13px',
                minWidth: '22px',
                textAlign: 'right',
                marginTop: '1px',
                flexShrink: 0,
              }}>
                {stepNum}.
              </span>
              <span style={{ color: '#e0f0ff' }}>{stepText}</span>
            </div>
          );
        }

        // ── Regular text line
        return (
          <div key={i} style={{ lineHeight: '1.7', color: '#e0f0ff' }}>
            {trimmed}
          </div>
        );
      })}
    </div>
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
