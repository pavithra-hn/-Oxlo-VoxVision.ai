import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, CameraOff, ScanEye, Volume2, Bot, Loader2, Maximize2,
  Wand2, BookOpen, Clapperboard, Send, X, Download,
  Sparkles, Globe, Eye, Mic, MicOff,
  Zap, Film, PenTool,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useWebcam } from '../hooks/useWebcam';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import {
  analyzeFrame, speakVisionText,
  whatIfReality, objectBiography, sceneDirector,
  type WhatIfResult, type BiographyResult, type SceneDirectorResult,
} from '../api/vision';
import { visionVoiceGreeting, visionVoicePipeline } from '../api/visionVoice';
import DetectionOverlay from './DetectionOverlay';
import VisionBackground from './VisionBackground';
import { cleanResponse } from '../utils/textCleaners';
import type { DetectionBox } from '../types';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  visionUsed?: boolean;
}

type VisionFeature = 'live' | 'whatif' | 'biography' | 'director';

const WHAT_IF_SUGGESTIONS = [
  'What if this was underwater?',
  'What if this was on Mars?',
  'What if this was in the year 3000?',
  'What if this was a Van Gogh painting?',
  'What if this was cyberpunk?',
  'What if this was in a fantasy world?',
];

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Glass card style constants
// ═══════════════════════════════════════════════════════════════════════════════
const GLASS = {
  bg: 'rgba(8, 12, 24, 0.85)',
  border: 'rgba(0, 170, 255, 0.08)',
  borderAccent: 'rgba(0, 170, 255, 0.15)',
  cardBg: 'rgba(0, 170, 255, 0.03)',
  cardBgAccent: 'rgba(0, 170, 255, 0.06)',
  text: '#e0f0ff',
  textMuted: 'rgba(0, 170, 255, 0.45)',
  accent: '#00AAFF',
};

export default function VisionMode() {
  const { videoRef, active, error, start, stop, captureFrame, startFrameCache, stopFrameCache, captureFreshFrame } = useWebcam();
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'speaking'>('idle');
  const [isStarting, setIsStarting] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Feature state ─────────────────────────────────────────
  const [activeFeature, setActiveFeature] = useState<VisionFeature>('live');
  const [featureBusy, setFeatureBusy] = useState(false);
  const [whatIfPrompt, setWhatIfPrompt] = useState('');
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [biographyResult, setBiographyResult] = useState<BiographyResult | null>(null);
  const [directorResult, setDirectorResult] = useState<SceneDirectorResult | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // ── Language & voice state ────────────────────────────────
  const [selectedLang, setSelectedLang] = useState('en');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState('');

  // ── Smart Voice Conversation (toggle mic) ─────────────────
  const { state: recState, audioBlob, start: startRec, stop: stopRec, reset: resetRec } = useVoiceRecorder();
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [visionPhase, setVisionPhase] = useState<
    'idle' | 'greeting' | 'listening' | 'processing' | 'looking' | 'speaking'
  >('idle');
  const [greetingDone, setGreetingDone] = useState(false);
  const pipelineBusyRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [captions, chatMessages, whatIfResult, biographyResult, directorResult]);

  // ── Standard vision analysis ──────────────────────────────
  const runAnalysis = useCallback(async (customPrompt?: string) => {
    if (busyRef.current || !active) return;
    const frame = captureFrame();
    if (!frame) return;
    busyRef.current = true;
    setPhase('analyzing');

    try {
      const prompt = customPrompt || voiceQuery.trim() || undefined;
      const { text, detections: boxes } = await analyzeFrame(frame, prompt, historyRef.current, selectedLang);
      setDetections(boxes);
      setCaptions(p => [...p, text]);
      historyRef.current.push({ role: 'assistant', content: text });
      setVoiceQuery('');

      setPhase('speaking');
      await speakVisionText(text, selectedLang);
      setPhase('idle');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Vision error');
      setPhase('idle');
    } finally {
      busyRef.current = false;
    }
  }, [active, captureFrame, voiceQuery, selectedLang]);

  const toggleCamera = async () => {
    if (active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      stop();
      stopFrameCache();
      setPhase('idle');
      setDetections([]);
      setVisionPhase('idle');
      setGreetingDone(false);
      setChatMessages([]);
    } else {
      setIsStarting(true);
      try {
        await start();
      } catch {
        setIsStarting(false);
        return;
      }
      setIsStarting(false);
      startFrameCache();

      if (activeFeature === 'live') {
        // Smart greeting flow: capture first frame after 1.5s
        setVisionPhase('greeting');
        setTimeout(async () => {
          const frame = captureFreshFrame();
          if (frame) {
            try {
              const { greeting_text } = await visionVoiceGreeting(frame, selectedLang);
              setChatMessages([{ role: 'assistant', content: greeting_text, timestamp: Date.now() }]);
              historyRef.current.push({ role: 'assistant', content: greeting_text });
              setVisionPhase('speaking');
              await speakVisionText(greeting_text, selectedLang);
              setVisionPhase('listening');
              setGreetingDone(true);
            } catch (err) {
              console.error('Greeting error:', err);
              // Fallback to old-style analysis
              runAnalysis();
              setVisionPhase('listening');
              setGreetingDone(true);
            }
          } else {
            setVisionPhase('listening');
            setGreetingDone(true);
          }
        }, 1500);
      } else {
        // Non-live features: no greeting, just start camera
        setVisionPhase('idle');
      }
    }
  };

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    stopFrameCache();
  }, [stopFrameCache]);

  useEffect(() => {
    if (activeFeature !== 'live' && active) {
      // Non-live features: stop smart voice mode, allow old scan
      setVisionPhase('idle');
    }
  }, [activeFeature, active]);

  // ── Smart Voice Pipeline: process audio blob from toggle mic ──
  useEffect(() => {
    if (!audioBlob || pipelineBusyRef.current || !active || activeFeature !== 'live') return;
    pipelineBusyRef.current = true;

    (async () => {
      try {
        setVisionPhase('processing');
        const frame = captureFreshFrame();

        const result = await visionVoicePipeline(
          audioBlob, frame, historyRef.current, selectedLang,
        );

        // Add user message
        if (result.cleaned_transcript.trim()) {
          setChatMessages(p => [...p, {
            role: 'user', content: result.cleaned_transcript, timestamp: Date.now(),
          }]);
          historyRef.current.push({ role: 'user', content: result.cleaned_transcript });
        }

        if (result.vision_used) setVisionPhase('looking');

        // Add assistant response
        const responseText = result.needs_recapture ? result.recapture_message : result.response;
        setChatMessages(p => [...p, {
          role: 'assistant', content: responseText, timestamp: Date.now(),
          visionUsed: result.vision_used,
        }]);
        historyRef.current.push({ role: 'assistant', content: responseText });

        if (result.detections?.length) setDetections(result.detections);

        setVisionPhase('speaking');
        await speakVisionText(responseText, selectedLang);
        setVisionPhase('listening');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Pipeline error');
        setVisionPhase('listening');
      } finally {
        pipelineBusyRef.current = false;
        resetRec();
      }
    })();
  }, [audioBlob, active, activeFeature, selectedLang, captureFreshFrame, resetRec]);

  // ── Toggle mic handler ────────────────────────────────────
  const handleMicToggle = useCallback(async () => {
    if (recState === 'recording') {
      stopRec();
    } else if (recState === 'idle' && visionPhase === 'listening') {
      try {
        await startRec();
      } catch {
        toast.error('Microphone access denied');
      }
    }
  }, [recState, visionPhase, startRec, stopRec]);

  // ── "What If" Reality Engine ──────────────────────────────
  const handleWhatIf = useCallback(async (prompt?: string) => {
    const finalPrompt = prompt || whatIfPrompt.trim();
    if (!finalPrompt || !active || featureBusy) return;
    const frame = captureFrame();
    if (!frame) return;

    setFeatureBusy(true);
    setWhatIfPrompt('');
    setWhatIfResult(null);

    try {
      const result = await whatIfReality(frame, finalPrompt, historyRef.current, selectedLang);
      setWhatIfResult(result);
      setDetections(result.detections);

      const voiceSummary = result.scene_description
        ? `${result.scene_description} ${result.narration}`
        : result.narration;
      await speakVisionText(voiceSummary, selectedLang);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'What If generation failed');
    } finally {
      setFeatureBusy(false);
    }
  }, [whatIfPrompt, active, featureBusy, captureFrame, selectedLang]);

  // ── Object Biography ──────────────────────────────────────
  const handleBiography = useCallback(async (detection?: DetectionBox) => {
    if (!active || featureBusy) return;
    const frame = captureFrame();
    if (!frame) return;

    setFeatureBusy(true);
    setBiographyResult(null);

    try {
      const result = await objectBiography(
        frame, detection?.label, detection?.bbox, historyRef.current, selectedLang,
      );
      setBiographyResult(result);

      const intro = detection?.label
        ? `Here's the story of ${result.object_name}. `
        : `Here's what I see. `;
      const voiceText = `${intro}${result.biography}`;
      await speakVisionText(voiceText, selectedLang);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Biography generation failed');
    } finally {
      setFeatureBusy(false);
    }
  }, [active, featureBusy, captureFrame, selectedLang]);

  // ── Scene Director ────────────────────────────────────────
  const handleDirector = useCallback(async () => {
    if (!active || featureBusy) return;
    const frame = captureFrame();
    if (!frame) return;

    setFeatureBusy(true);
    setDirectorResult(null);

    try {
      const result = await sceneDirector(frame, historyRef.current, selectedLang);
      setDirectorResult(result);
      setDetections(result.detections);

      // Voice: announce the movie + trailer script
      const voiceText = `${result.title}. A ${result.genre} film. ${result.tagline}. ${result.trailer_script}`;
      await speakVisionText(voiceText, selectedLang);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scene Director failed');
    } finally {
      setFeatureBusy(false);
    }
  }, [active, featureBusy, captureFrame, selectedLang]);


  const handleDownload = useCallback((imageB64: string, name: string) => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${imageB64}`;
    link.download = `Oxlo_VoxVision-${name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const statusText = featureBusy
    ? activeFeature === 'whatif' ? 'Reimagining...'
      : activeFeature === 'biography' ? 'Writing story...'
      : activeFeature === 'director' ? 'Directing...'
      : 'Processing...'
    : visionPhase === 'greeting' ? 'Meeting you...'
    : visionPhase === 'listening' ? 'Listening...'
    : visionPhase === 'processing' ? 'Thinking...'
    : visionPhase === 'looking' ? 'Looking...'
    : visionPhase === 'speaking' ? 'Speaking...'
    : phase === 'analyzing' ? 'Analyzing...'
    : phase === 'speaking' ? 'Speaking...'
    : greetingDone ? 'Ready' : 'Ready';

  const FEATURES: { id: VisionFeature; icon: typeof Wand2; label: string; desc: string }[] = [
    { id: 'live', icon: ScanEye, label: 'AI Vision', desc: 'Smart voice + vision chat' },
    { id: 'whatif', icon: Wand2, label: 'What If', desc: 'Reimagine your reality' },
    { id: 'biography', icon: BookOpen, label: 'Biographies', desc: 'Object life stories' },
    { id: 'director', icon: Clapperboard, label: 'Director', desc: 'Movie poster from scene' },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="h-full flex flex-col relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #050710 0%, #0a0f1e 40%, #060c18 100%)' }}
    >
      {/* ── Video element ALWAYS rendered (hidden when idle) ─────── */}
      <video
        ref={videoRef}
        className="fixed"
        style={{ opacity: 0, pointerEvents: 'none', width: 1, height: 1, zIndex: -999 }}
        muted playsInline
      />

      {/* ── Ambient background (idle only) ────────────────────── */}
      {!active && <VisionBackground />}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* IDLE STATE                                                */}
      {/* ══════════════════════════════════════════════════════════ */}
      {!active && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none pt-24 pb-12 overflow-y-auto">
          <motion.div
            className="flex flex-col items-center my-auto w-full px-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Camera placeholder with open button */}
            <motion.div
              onClick={() => !isStarting && toggleCamera()}
              className="w-full max-w-[400px] aspect-video rounded-2xl flex flex-col items-center justify-center shrink-0 cursor-pointer relative overflow-hidden"
              style={{ background: 'rgba(0,170,255,0.02)', border: '2px dashed rgba(0,170,255,0.3)' }}
              animate={{ boxShadow: ['0 0 0 rgba(0,170,255,0)', '0 0 30px rgba(0,170,255,0.06)', '0 0 0 rgba(0,170,255,0)'] }}
              whileHover={{ borderColor: 'rgba(0,170,255,0.5)', background: 'rgba(0,170,255,0.04)' }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              {/* Scanning line preview */}
              <motion.div className="absolute left-0 right-0 h-[1px]"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(0,170,255,0.3), transparent)' }}
                animate={{ top: ['0%', '100%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
              <Eye className="w-8 h-8 mb-2" style={{ color: 'rgba(0,170,255,0.4)' }} />
              <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(0,170,255,0.4)' }}>Click to open camera</span>
              <span className="text-[9px] mt-1" style={{ color: 'rgba(0,170,255,0.2)' }}>AI will see you and start a conversation</span>
            </motion.div>

            <div className="text-center mt-6 mb-5">
              <h2 className="text-3xl font-bold" style={{ color: GLASS.accent }}>Vision AI Assistant</h2>
              <p className="text-sm mt-2 font-medium" style={{ color: 'rgba(224,240,255,0.6)' }}>I can see you, hear you, and help you</p>
              <div className="flex items-center justify-center gap-3 mt-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.12)', color: 'rgba(0,170,255,0.5)' }}><Eye className="w-2.5 h-2.5" />Visual Awareness</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.12)', color: 'rgba(34,197,94,0.5)' }}><Mic className="w-2.5 h-2.5" />Voice Chat</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)', color: 'rgba(139,92,246,0.5)' }}><Sparkles className="w-2.5 h-2.5" />Smart Intent</span>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3 pointer-events-auto">
              {FEATURES.filter(f => f.id !== 'live').map(f => (
                <motion.div key={f.id} whileHover={{ scale: 1.05 }} onClick={() => setActiveFeature(f.id)}
                  className="px-4 py-3.5 w-[130px] rounded-2xl text-center cursor-pointer"
                  style={{ background: activeFeature === f.id ? GLASS.cardBgAccent : GLASS.cardBg, border: `1px solid ${GLASS.borderAccent}` }}
                >
                  <f.icon className="w-5 h-5 mx-auto mb-1.5" style={{ color: GLASS.accent }} />
                  <p className="text-[12px] font-bold" style={{ color: GLASS.accent }}>{f.label}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: GLASS.textMuted }}>{f.desc}</p>
                </motion.div>
              ))}
            </div>

            <motion.button onClick={toggleCamera} disabled={isStarting} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              className="mt-5 pointer-events-auto flex items-center gap-3 px-7 py-3.5 rounded-full cursor-pointer disabled:opacity-80"
              style={{ background: isStarting ? 'rgba(0,170,255,0.1)' : 'linear-gradient(135deg,#00AAFF,#0088CC)', border: isStarting ? `1px solid ${GLASS.border}` : 'none', boxShadow: isStarting ? 'none' : '0 8px 25px rgba(0,170,255,0.35)' }}
            >
              {isStarting ? <><Loader2 className="w-4 h-4 animate-spin" style={{ color: GLASS.accent }} /><span className="text-sm font-bold uppercase" style={{ color: GLASS.accent }}>Initializing...</span></>
                : <><Camera className="w-4 h-4 text-white" /><span className="text-sm font-bold text-white uppercase">Open Camera</span></>}
            </motion.button>
          </motion.div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ACTIVE STATE — Split Layout                               */}
      {/* Camera Card LEFT (45%) | Insights RIGHT (55%)             */}
      {/* ══════════════════════════════════════════════════════════ */}
      {active && (
        <div className="absolute inset-0 flex gap-3 p-3" style={{ paddingTop: '78px' }}>

          {/* ══════════════ LEFT PANEL: Camera Card ══════════════ */}
          <div className="flex flex-col gap-3" style={{ width: '45%', minWidth: '340px' }}>

            {/* Camera Feed Card */}
            <div className="relative flex-1 rounded-2xl overflow-hidden"
              style={{
                background: '#000',
                border: `1px solid ${GLASS.border}`,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 1px rgba(0,170,255,0.1)',
              }}
            >
              {/* Display video — shares stream from hidden source video */}
              <video
                ref={(el) => {
                  if (el && videoRef.current && videoRef.current.srcObject) {
                    el.srcObject = videoRef.current.srcObject;
                    el.play().catch(() => {});
                  }
                }}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
                muted playsInline autoPlay
              />

              {/* Detection overlay on top of camera */}
              <DetectionOverlay detections={detections} videoRef={videoRef} />

              {/* Scanning line */}
              {(phase === 'analyzing' || featureBusy) && (
                <motion.div className="absolute left-0 right-0 h-[2px] z-20"
                  style={{ background: 'linear-gradient(90deg, transparent, #00AAFF, transparent)', boxShadow: '0 0 15px #00AAFF' }}
                  animate={{ top: ['0%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              )}

              {/* Top-left badge — live feature + phase */}
              <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-full z-20"
                style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', border: `1px solid ${GLASS.border}` }}
              >
                <div className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: visionPhase === 'listening' ? '#22c55e' : visionPhase === 'looking' ? '#f59e0b' : visionPhase === 'speaking' ? '#8b5cf6' : GLASS.accent }}></span>
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: visionPhase === 'listening' ? '#22c55e' : visionPhase === 'looking' ? '#f59e0b' : visionPhase === 'speaking' ? '#8b5cf6' : GLASS.accent }}></span>
                </div>
                <span className="text-[9px] font-bold uppercase" style={{ color: visionPhase === 'listening' ? '#22c55e' : visionPhase === 'looking' ? '#f59e0b' : visionPhase === 'speaking' ? '#8b5cf6' : GLASS.accent, letterSpacing: '0.06em' }}>{FEATURES.find(f => f.id === activeFeature)?.label}</span>
              </div>

              {/* Top-right status — always visible when smart mode active */}
              <AnimatePresence>
                {(phase !== 'idle' || featureBusy || (activeFeature === 'live' && visionPhase !== 'idle')) && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full z-20"
                    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', border: `1px solid ${visionPhase === 'listening' ? 'rgba(34,197,94,0.2)' : visionPhase === 'looking' ? 'rgba(245,158,11,0.2)' : GLASS.border}` }}
                  >
                    {visionPhase === 'listening' ? <Mic className="w-3 h-3" style={{ color: '#22c55e' }} />
                      : visionPhase === 'processing' || visionPhase === 'greeting' ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: GLASS.accent }} />
                      : visionPhase === 'looking' ? <Eye className="w-3 h-3" style={{ color: '#f59e0b' }} />
                      : visionPhase === 'speaking' ? <Volume2 className="w-3 h-3" style={{ color: '#8b5cf6' }} />
                      : (phase === 'analyzing' || featureBusy) ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: GLASS.accent }} />
                      : <Volume2 className="w-3 h-3" style={{ color: GLASS.accent }} />}
                    <span className="text-[9px] font-bold uppercase" style={{ color: visionPhase === 'listening' ? '#22c55e' : visionPhase === 'looking' ? '#f59e0b' : visionPhase === 'speaking' ? '#8b5cf6' : GLASS.accent }}>{statusText}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Bottom detection count */}
              {detections.length > 0 && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full z-20"
                  style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', border: `1px solid ${GLASS.border}` }}
                >
                  <Eye className="w-3 h-3" style={{ color: GLASS.accent }} />
                  <span className="text-[9px] font-bold" style={{ color: GLASS.accent }}>{detections.length} object{detections.length !== 1 ? 's' : ''}</span>
                </motion.div>
              )}
            </div>

            {/* ── Camera Controls Bar — mirrors VoiceMode style ──── */}
            <div className="flex items-center justify-center gap-3 p-3 rounded-2xl shrink-0"
              style={{ background: GLASS.bg, border: `1px solid ${GLASS.border}` }}
            >
              {/* Force scan — small icon circle */}
              {activeFeature === 'live' && (
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                  onClick={() => runAnalysis()} disabled={phase !== 'idle'}
                  className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30"
                  style={{ background: 'rgba(0,170,255,0.05)', border: '1px solid rgba(0,170,255,0.1)', color: GLASS.textMuted }}
                  title="Force Scan"
                >
                  {phase === 'analyzing' ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanEye className="w-5 h-5" />}
                </motion.button>
              )}

              {/* Mic button — TOGGLE with animated recording ring */}
              <div className="relative">
                {/* Pulsing ring when recording */}
                {recState === 'recording' && (
                  <>
                    <motion.div className="absolute inset-0 rounded-full"
                      style={{ background: 'rgba(255,68,68,0.15)' }}
                      animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: 'easeOut' }}
                    />
                    <motion.div className="absolute inset-0 rounded-full"
                      style={{ border: '2px solid rgba(255,68,68,0.5)' }}
                      animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: 'easeOut', delay: 0.3 }}
                    />
                  </>
                )}
                {/* Listening pulse ring */}
                {recState === 'idle' && visionPhase === 'listening' && (
                  <motion.div className="absolute inset-0 rounded-full"
                    style={{ border: '1.5px solid rgba(34,197,94,0.3)' }}
                    animate={{ scale: [1, 1.3], opacity: [0.5, 0] }}
                    transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
                  />
                )}
                <motion.button
                  whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                  onClick={handleMicToggle}
                  disabled={visionPhase === 'processing' || visionPhase === 'speaking' || visionPhase === 'greeting'}
                  className="relative w-12 h-12 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30"
                  style={{
                    background: recState === 'recording' ? 'rgba(255,68,68,0.15)' : visionPhase === 'listening' ? 'rgba(34,197,94,0.08)' : 'rgba(0,170,255,0.05)',
                    border: recState === 'recording' ? '1.5px solid rgba(255,68,68,0.5)' : visionPhase === 'listening' ? '1.5px solid rgba(34,197,94,0.25)' : '1px solid rgba(0,170,255,0.1)',
                    color: recState === 'recording' ? '#ff4444' : visionPhase === 'listening' ? '#22c55e' : GLASS.textMuted,
                    boxShadow: recState === 'recording' ? '0 0 20px rgba(255,68,68,0.25)' : visionPhase === 'listening' ? '0 0 12px rgba(34,197,94,0.1)' : 'none',
                  }}
                  title={recState === 'recording' ? 'Tap to stop' : 'Tap to speak'}
                >
                  {recState === 'recording' ? <MicOff className="w-5 h-5" /> : recState === 'processing' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
                </motion.button>
              </div>

              {/* ── Main Camera Toggle — BIG w-16 h-16 circle, mirrors VoiceMode mic button ── */}
              <motion.button
                onClick={toggleCamera}
                whileTap={{ scale: 0.95 }}
                className="relative w-16 h-16 rounded-full flex items-center justify-center cursor-pointer overflow-hidden"
                title={active ? 'Close Camera' : 'Open Camera'}
              >
                {/* Gradient background */}
                <div className="absolute inset-0 rounded-full transition-all duration-500"
                  style={{
                    background: active
                      ? 'linear-gradient(135deg, #ff4444, #cc0000)'
                      : 'linear-gradient(135deg, #00AAFF, #0088CC)',
                    boxShadow: active
                      ? '0 0 30px rgba(255,68,68,0.35)'
                      : '0 0 30px rgba(0,170,255,0.3)',
                  }}
                />
                {/* Pulse ring (idle camera off — inviting to open) */}
                {!active && (
                  <>
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ background: 'rgba(0,170,255,0.25)' }}
                      animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
                    />
                    <motion.div
                      className="absolute inset-0 rounded-full"
                      style={{ border: '2px solid rgba(0,170,255,0.8)' }}
                      animate={{ scale: [1, 1.4], opacity: [0.8, 0] }}
                      transition={{ repeat: Infinity, duration: 2, ease: 'easeOut', delay: 0.5 }}
                    />
                  </>
                )}
                {/* Icon */}
                <div className="relative z-10">
                  {isStarting
                    ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                    : active
                      ? <CameraOff className="w-6 h-6 text-white" />
                      : <Camera className="w-6 h-6 text-white" />}
                </div>
                {/* Subtle border overlay */}
                <div className="absolute inset-0 rounded-full border border-white/10 pointer-events-none" />
              </motion.button>

              {/* Language — small icon circle */}
              <div className="relative">
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                  onClick={() => setShowLangPicker(p => !p)}
                  className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(0,170,255,0.05)', border: '1px solid rgba(0,170,255,0.1)', color: GLASS.textMuted }}
                  title="Language"
                >
                  <Globe className="w-5 h-5" />
                </motion.button>

                <AnimatePresence>
                  {showLangPicker && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 rounded-xl p-1.5 min-w-[130px] z-50"
                      style={{ background: 'rgba(8,12,24,0.97)', border: `1px solid ${GLASS.borderAccent}`, boxShadow: '0 12px 40px rgba(0,0,0,0.8)' }}
                    >
                      {LANGUAGES.map(l => (
                        <button key={l.code} onClick={() => { setSelectedLang(l.code); setShowLangPicker(false); }}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-2 cursor-pointer transition-colors"
                          style={{ background: selectedLang === l.code ? GLASS.cardBgAccent : 'transparent', color: selectedLang === l.code ? GLASS.accent : GLASS.textMuted }}
                        >
                          <span>{l.flag}</span><span className="font-medium">{l.name}</span>
                          {selectedLang === l.code && <Zap className="w-2.5 h-2.5 ml-auto" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* ══════════════ RIGHT PANEL: Insights ══════════════ */}
          <div className="flex-1 flex flex-col min-w-0 gap-3">

            {/* Feature Toolbar */}
            <div className="flex p-1.5 gap-1 shrink-0 rounded-2xl"
              style={{ background: GLASS.bg, border: `1px solid ${GLASS.border}` }}
            >
              {FEATURES.map(f => {
                const isAct = activeFeature === f.id;
                return (
                  <button key={f.id}
                    onClick={() => { setActiveFeature(f.id); setWhatIfResult(null); setBiographyResult(null); setDirectorResult(null); }}
                    className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold cursor-pointer flex-1 justify-center transition-all"
                    style={{ color: isAct ? GLASS.accent : GLASS.textMuted, background: isAct ? GLASS.cardBgAccent : 'transparent', border: isAct ? `1px solid ${GLASS.borderAccent}` : '1px solid transparent' }}
                  >
                    <f.icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{f.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Scrollable Content Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl p-4 space-y-3"
              style={{ background: GLASS.bg, border: `1px solid ${GLASS.border}`, scrollBehavior: 'smooth' }}
            >
              {/* ═════════ LIVE SCAN — Smart Conversation ═════════ */}
              {activeFeature === 'live' && (
                <>
                  {/* Phase indicator bar */}
                  {visionPhase !== 'idle' && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl"
                      style={{
                        background: visionPhase === 'greeting' ? 'linear-gradient(135deg, rgba(0,170,255,0.06), rgba(0,170,255,0.02))'
                          : visionPhase === 'listening' ? 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))'
                          : visionPhase === 'processing' ? 'linear-gradient(135deg, rgba(0,170,255,0.06), rgba(0,170,255,0.02))'
                          : visionPhase === 'looking' ? 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02))'
                          : visionPhase === 'speaking' ? 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02))'
                          : GLASS.cardBg,
                        border: `1px solid ${visionPhase === 'listening' ? 'rgba(34,197,94,0.12)' : visionPhase === 'looking' ? 'rgba(245,158,11,0.12)' : visionPhase === 'speaking' ? 'rgba(139,92,246,0.12)' : GLASS.border}`,
                      }}
                    >
                      {visionPhase === 'greeting' && <><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GLASS.accent }} /><span className="text-[10px] font-bold" style={{ color: GLASS.accent }}>Getting ready to see you...</span></>}
                      {visionPhase === 'listening' && <><motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}><Mic className="w-3.5 h-3.5" style={{ color: '#22c55e' }} /></motion.div><span className="text-[10px] font-bold" style={{ color: '#22c55e' }}>Listening — tap mic and speak</span></>}
                      {visionPhase === 'processing' && <><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GLASS.accent }} /><span className="text-[10px] font-bold" style={{ color: GLASS.accent }}>Processing your speech...</span></>}
                      {visionPhase === 'looking' && <><motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 1 }}><Eye className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} /></motion.div><span className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>Looking at you...</span></>}
                      {visionPhase === 'speaking' && <><motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}><Volume2 className="w-3.5 h-3.5" style={{ color: '#8b5cf6' }} /></motion.div><span className="text-[10px] font-bold" style={{ color: '#8b5cf6' }}>Speaking...</span></>}
                      {recState === 'recording' && <><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[10px] font-bold text-red-400">Recording — tap mic to stop</span></>}
                    </motion.div>
                  )}

                  {/* Detections chips */}
                  {detections.length > 0 && (
                    <SectionCard icon={Eye} title="Objects Detected" accent>
                      <div className="flex flex-wrap gap-1.5">
                        {detections.map((d, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: GLASS.cardBgAccent, border: `1px solid ${GLASS.borderAccent}`, color: GLASS.accent }}
                          >
                            {d.label}
                            <span className="opacity-40 text-[8px]">{Math.round(d.confidence * 100)}%</span>
                          </span>
                        ))}
                      </div>
                    </SectionCard>
                  )}

                  {/* Chat messages — conversational bubbles */}
                  {chatMessages.length === 0 && !greetingDone ? (
                    <div className="flex flex-col items-center justify-center py-14 gap-3">
                      {visionPhase === 'greeting' ? (
                        <>
                          <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'rgba(0,170,255,0.3)' }} />
                          <p className="text-[11px] text-center" style={{ color: 'rgba(0,170,255,0.3)' }}>Looking at you for the first time...</p>
                        </>
                      ) : (
                        <>
                          <Eye className="w-7 h-7" style={{ color: 'rgba(0,170,255,0.15)' }} />
                          <p className="text-[11px] text-center" style={{ color: 'rgba(0,170,255,0.2)' }}>Open camera to start a visual conversation</p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {chatMessages.map((msg, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 }}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[90%] p-3 rounded-2xl ${msg.role === 'assistant' ? 'pl-3.5' : ''}`}
                            style={{
                              background: msg.role === 'user'
                                ? 'linear-gradient(135deg, rgba(0,170,255,0.12), rgba(0,170,255,0.06))'
                                : 'linear-gradient(135deg, rgba(8,15,30,0.95), rgba(10,18,35,0.9))',
                              border: `1px solid ${msg.role === 'user' ? GLASS.borderAccent : GLASS.border}`,
                              borderBottomRightRadius: msg.role === 'user' ? '4px' : undefined,
                              borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : undefined,
                            }}
                          >
                            {/* Badge row */}
                            <div className="flex items-center gap-1.5 mb-1.5">
                              {msg.role === 'assistant' && (
                                <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,170,255,0.15), rgba(0,170,255,0.05))', border: '1px solid rgba(0,170,255,0.2)' }}>
                                  <Bot className="w-2.5 h-2.5" style={{ color: GLASS.accent }} />
                                </div>
                              )}
                              <span className="text-[9px] font-bold uppercase" style={{ color: GLASS.textMuted, letterSpacing: '0.05em' }}>
                                {msg.role === 'user' ? 'You' : 'Oxlo AI'}
                              </span>
                              {msg.visionUsed && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                                  <Eye className="w-2 h-2" />vision
                                </span>
                              )}
                              {msg.role === 'user' && (
                                <span className="w-4 h-4 rounded-full flex items-center justify-center ml-auto" style={{ background: 'linear-gradient(135deg, rgba(0,170,255,0.12), rgba(0,170,255,0.05))', border: '1px solid rgba(0,170,255,0.15)' }}>
                                  <Mic className="w-2.5 h-2.5" style={{ color: GLASS.textMuted }} />
                                </span>
                              )}
                            </div>
                            <p className="text-[13px] leading-[1.7]" style={{ color: GLASS.text }}>{cleanResponse(msg.content)}</p>
                          </div>
                        </motion.div>
                      ))}

                      {/* Typing indicator — AI is thinking */}
                      {(visionPhase === 'processing' || visionPhase === 'looking') && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                          <div className="px-4 py-3 rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(8,15,30,0.95), rgba(10,18,35,0.9))', border: `1px solid ${GLASS.border}`, borderBottomLeftRadius: '4px' }}>
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,170,255,0.15), rgba(0,170,255,0.05))', border: '1px solid rgba(0,170,255,0.2)' }}>
                                {visionPhase === 'looking' ? <Eye className="w-2.5 h-2.5" style={{ color: '#f59e0b' }} /> : <Bot className="w-2.5 h-2.5" style={{ color: GLASS.accent }} />}
                              </div>
                              <div className="flex gap-1">
                                <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: visionPhase === 'looking' ? '#f59e0b' : GLASS.accent }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} />
                                <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: visionPhase === 'looking' ? '#f59e0b' : GLASS.accent }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} />
                                <motion.span className="w-1.5 h-1.5 rounded-full" style={{ background: visionPhase === 'looking' ? '#f59e0b' : GLASS.accent }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} />
                              </div>
                              <span className="text-[9px] font-bold" style={{ color: visionPhase === 'looking' ? '#f59e0b' : GLASS.textMuted }}>{visionPhase === 'looking' ? 'Analyzing what I see...' : 'Thinking...'}</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Text query input (fallback for typed questions) */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}` }}
                  >
                    <Bot className="w-3.5 h-3.5 shrink-0" style={{ color: GLASS.textMuted }} />
                    <input value={voiceQuery} onChange={e => setVoiceQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') runAnalysis(); }}
                      placeholder="Type a question or tap the mic to speak..."
                      className="flex-1 bg-transparent outline-none text-[12px] placeholder:text-[rgba(0,170,255,0.18)]"
                      style={{ color: GLASS.text }}
                    />
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={() => runAnalysis()} disabled={phase !== 'idle' || !voiceQuery.trim()}
                      className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30"
                      style={{ background: voiceQuery.trim() ? 'linear-gradient(135deg,#00AAFF,#0088CC)' : GLASS.cardBg }}
                    >
                      <Send className="w-3 h-3 text-white" />
                    </motion.button>
                  </div>
                </>
              )}

              {/* ═════════ WHAT IF ═════════ */}
              {activeFeature === 'whatif' && (
                <>
                  {!whatIfResult && !featureBusy && (
                    <SectionCard icon={Wand2} title="What If Reality Engine">
                      <p className="text-[11px] mb-3" style={{ color: GLASS.textMuted }}>Reimagine what your camera sees under any scenario</p>
                      <div className="space-y-1.5">
                        {WHAT_IF_SUGGESTIONS.map(s => (
                          <motion.button key={s} whileHover={{ scale: 1.01, backgroundColor: GLASS.cardBgAccent }} whileTap={{ scale: 0.99 }}
                            onClick={() => handleWhatIf(s)}
                            className="w-full text-left px-3 py-2 rounded-lg text-[11px] flex items-center gap-2 cursor-pointer"
                            style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}`, color: GLASS.textMuted }}
                          >
                            <Sparkles className="w-3 h-3 shrink-0 opacity-40" />{s}
                          </motion.button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl"
                        style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}` }}
                      >
                        <Wand2 className="w-3.5 h-3.5 shrink-0" style={{ color: GLASS.textMuted }} />
                        <input value={whatIfPrompt} onChange={e => setWhatIfPrompt(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleWhatIf(); }}
                          placeholder="What if this was..." className="flex-1 bg-transparent outline-none text-[12px] placeholder:text-[rgba(0,170,255,0.18)]" style={{ color: GLASS.text }} />
                        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                          onClick={() => handleWhatIf()} disabled={!whatIfPrompt.trim()}
                          className="w-6 h-6 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30"
                          style={{ background: whatIfPrompt.trim() ? 'linear-gradient(135deg,#00AAFF,#0088CC)' : GLASS.cardBg }}
                        >
                          <Send className="w-3 h-3 text-white" />
                        </motion.button>
                      </div>
                    </SectionCard>
                  )}

                  {featureBusy && <FeatureLoadingState label="Reimagining your reality..." />}

                  {whatIfResult && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <SectionCard icon={Eye} title="Scene Understood">
                        <p className="text-[12px] leading-[1.7]" style={{ color: 'rgba(224,240,255,0.65)' }}>{cleanResponse(whatIfResult.scene_description)}</p>
                      </SectionCard>
                      <SectionCard icon={Wand2} title="Reimagined Reality">
                        <ImageCard imageB64={whatIfResult.generated_image_b64} alt="What If" onExpand={() => setLightboxImage(whatIfResult.generated_image_b64)} />
                      </SectionCard>
                      <SectionCard icon={Bot} title="Narration">
                        <p className="text-[12px] leading-[1.7] italic" style={{ color: GLASS.text }}>"{cleanResponse(whatIfResult.narration)}"</p>
                      </SectionCard>
                      <div className="flex gap-2">
                        <ActionButton icon={Download} label="Download" onClick={() => handleDownload(whatIfResult.generated_image_b64, 'whatif')} />
                        <ActionButton icon={Wand2} label="Try Another" onClick={() => setWhatIfResult(null)} />
                      </div>
                    </motion.div>
                  )}
                </>
              )}

              {/* ═════════ BIOGRAPHY ═════════ */}
              {activeFeature === 'biography' && (
                <>
                  {!biographyResult && !featureBusy && (
                    <SectionCard icon={BookOpen} title="Object Biographies">
                      <p className="text-[11px] mb-3" style={{ color: GLASS.textMuted }}>Discover the imagined life story of any object</p>
                      {detections.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-medium uppercase block mb-1" style={{ color: GLASS.textMuted, letterSpacing: '0.04em' }}>Detected Objects</span>
                          {detections.map((d, i) => (
                            <motion.button key={i} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                              onClick={() => handleBiography(d)}
                              className="w-full text-left px-3 py-2.5 rounded-lg text-[12px] flex items-center justify-between cursor-pointer"
                              style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}`, color: GLASS.textMuted }}
                            >
                              <span className="flex items-center gap-2"><BookOpen className="w-3 h-3 opacity-40" />{d.label}</span>
                              <span className="text-[9px] opacity-30">{Math.round(d.confidence * 100)}%</span>
                            </motion.button>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={() => handleBiography()}
                            className="w-full text-center px-4 py-4 rounded-xl text-[12px] cursor-pointer"
                            style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}`, color: GLASS.textMuted }}
                          >
                            <BookOpen className="w-5 h-5 mx-auto mb-2 opacity-40" />Tell me the story of what you see
                          </motion.button>
                          <motion.button whileHover={{ scale: 1.01 }} onClick={() => runAnalysis()} disabled={phase !== 'idle'}
                            className="w-full text-center px-3 py-2 rounded-lg text-[10px] cursor-pointer disabled:opacity-30"
                            style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}`, color: GLASS.textMuted }}
                          >
                            <ScanEye className="w-3 h-3 inline mr-1" />Scan for objects first
                          </motion.button>
                        </div>
                      )}
                    </SectionCard>
                  )}

                  {featureBusy && <FeatureLoadingState label="Writing the biography..." />}

                  {biographyResult && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <SectionCard icon={BookOpen} title="The Story Of" accent>
                        <h3 className="text-lg font-bold" style={{ color: GLASS.accent }}>{biographyResult.object_name}</h3>
                      </SectionCard>
                      <SectionCard icon={PenTool} title="Biography">
                        <p className="text-[12px] leading-[1.7] italic" style={{ color: GLASS.text }}>"{cleanResponse(biographyResult.biography)}"</p>
                      </SectionCard>
                      <SectionCard icon={Sparkles} title="Origin Story">
                        <ImageCard imageB64={biographyResult.origin_image_b64} alt="Origin" onExpand={() => setLightboxImage(biographyResult.origin_image_b64)} />
                      </SectionCard>
                      <div className="flex gap-2">
                        <ActionButton icon={Download} label="Download" onClick={() => handleDownload(biographyResult.origin_image_b64, biographyResult.object_name)} />
                        <ActionButton icon={BookOpen} label="Another Object" onClick={() => setBiographyResult(null)} />
                      </div>
                    </motion.div>
                  )}
                </>
              )}

              {/* ═════════ SCENE DIRECTOR ═════════ */}
              {activeFeature === 'director' && (
                <>
                  {!directorResult && !featureBusy && (
                    <SectionCard icon={Clapperboard} title="Scene Director">
                      <div className="flex flex-col items-center gap-3 py-8">
                        <Film className="w-9 h-9" style={{ color: 'rgba(0,170,255,0.2)' }} />
                        <p className="text-[11px] text-center max-w-[200px]" style={{ color: GLASS.textMuted }}>Turn your scene into a cinematic movie poster</p>
                        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleDirector}
                          className="px-5 py-2.5 rounded-full text-[12px] font-semibold cursor-pointer flex items-center gap-2"
                          style={{ background: `linear-gradient(135deg, ${GLASS.cardBgAccent}, ${GLASS.cardBg})`, border: `1px solid ${GLASS.borderAccent}`, color: GLASS.accent }}
                        >
                          <Clapperboard className="w-3.5 h-3.5" />Action!
                        </motion.button>
                      </div>
                    </SectionCard>
                  )}

                  {featureBusy && <FeatureLoadingState label="Directing your movie..." />}

                  {directorResult && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                      <SectionCard icon={Film} title="Movie Details" accent>
                        <div className="text-center">
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase mb-1.5"
                            style={{ background: GLASS.cardBgAccent, border: `1px solid ${GLASS.borderAccent}`, color: GLASS.accent, letterSpacing: '0.06em' }}
                          >{directorResult.genre}</span>
                          <h3 className="text-xl font-bold" style={{ color: GLASS.text }}>{directorResult.title}</h3>
                          <p className="text-[12px] mt-1 italic" style={{ color: GLASS.textMuted }}>"{directorResult.tagline}"</p>
                        </div>
                      </SectionCard>
                      <SectionCard icon={Clapperboard} title="Movie Poster">
                        <ImageCard imageB64={directorResult.poster_image_b64} alt="Poster" onExpand={() => setLightboxImage(directorResult.poster_image_b64)} />
                      </SectionCard>
                      <SectionCard icon={Bot} title="🎬 Trailer Narration">
                        <p className="text-[12px] leading-[1.7] italic" style={{ color: GLASS.text }}>"{directorResult.trailer_script}"</p>
                      </SectionCard>
                      <div className="flex gap-2">
                        <ActionButton icon={Download} label="Download Poster" onClick={() => handleDownload(directorResult.poster_image_b64, directorResult.title)} />
                        <ActionButton icon={Clapperboard} label="Re-Direct" onClick={() => setDirectorResult(null)} />
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ──────────────────────────────────────────── */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)' }}
            onClick={() => setLightboxImage(null)}
          >
            <motion.div initial={{ scale: 0.85 }} animate={{ scale: 1 }} exit={{ scale: 0.85 }}
              transition={{ type: 'spring', bounce: 0.15 }}
              className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}
            >
              <img src={`data:image/png;base64,${lightboxImage}`} alt="Fullscreen"
                className="rounded-2xl max-w-full max-h-[85vh] object-contain"
                style={{ border: `1px solid ${GLASS.borderAccent}`, boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}
              />
              <button onClick={() => setLightboxImage(null)}
                className="absolute -top-3 -right-3 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: 'rgba(8,12,24,0.9)', border: `1px solid ${GLASS.borderAccent}`, color: GLASS.accent }}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 text-white px-5 py-2.5 rounded-full shadow-2xl"
          style={{ background: 'rgba(255,68,68,0.9)', backdropFilter: 'blur(8px)' }}
        >
          <p className="font-bold text-xs">{error}</p>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Reusable Sub-Components
// ═══════════════════════════════════════════════════════════════════════════════

function SectionCard({ icon: Icon, title, accent, children }: { icon: typeof Bot; title: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={{ background: accent ? GLASS.cardBgAccent : GLASS.cardBg, border: `1px solid ${accent ? GLASS.borderAccent : GLASS.border}` }}
    >
      <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${GLASS.border}` }}>
        <Icon className="w-3 h-3" style={{ color: GLASS.accent }} />
        <span className="text-[9px] font-bold uppercase" style={{ color: GLASS.textMuted, letterSpacing: '0.06em' }}>{title}</span>
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </motion.div>
  );
}

function ImageCard({ imageB64, alt, onExpand }: { imageB64: string; alt: string; onExpand: () => void }) {
  return (
    <div className="rounded-xl overflow-hidden cursor-pointer group relative"
      style={{ border: `1px solid ${GLASS.borderAccent}`, boxShadow: '0 6px 24px rgba(0,0,0,0.4)' }}
      onClick={onExpand}
    >
      <img src={`data:image/png;base64,${imageB64}`} alt={alt} className="w-full h-auto" />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
        <Maximize2 className="w-5 h-5 text-white" />
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: typeof Download; label: string; onClick: () => void }) {
  return (
    <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-medium cursor-pointer"
      style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.border}`, color: GLASS.textMuted }}
    >
      <Icon className="w-3 h-3" />{label}
    </motion.button>
  );
}

function FeatureLoadingState({ label }: { label: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-10 gap-3"
    >
      <motion.div className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: GLASS.cardBg, border: `1px solid ${GLASS.borderAccent}` }}
        animate={{ boxShadow: ['0 0 0 rgba(0,170,255,0)', '0 0 25px rgba(0,170,255,0.12)', '0 0 0 rgba(0,170,255,0)'] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: GLASS.accent }} />
      </motion.div>
      <p className="text-[12px] font-medium" style={{ color: GLASS.textMuted }}>{label}</p>
      <div className="space-y-1.5 w-full max-w-[160px]">
        <ShimmerBar width="100%" /><ShimmerBar width="70%" /><ShimmerBar width="45%" />
      </div>
    </motion.div>
  );
}

function ShimmerBar({ width }: { width: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ width, background: GLASS.cardBg }}>
      <motion.div className="h-full w-1/2 rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${GLASS.cardBgAccent}, transparent)` }}
        animate={{ x: ['-100%', '300%'] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
      />
    </div>
  );
}
