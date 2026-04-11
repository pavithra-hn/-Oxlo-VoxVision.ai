
import { useEffect, useState, type FC } from 'react';
import { Link } from 'react-router-dom';

const LandingPage: FC = () => {
  const [themeMode, setThemeMode] = useState<string>('system');
  const [activeSection, setActiveSection] = useState<string>('hero');

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
      const intersecting = entries.filter(entry => entry.isIntersecting);
      intersecting.forEach((entry, index) => {
        setTimeout(() => {
          entry.target.classList.add('in-view');
        }, index * 120);
        observer.unobserve(entry.target);
      });
    }, observerOptions);

    document.querySelectorAll('.glass-card, .highway-lane').forEach(el => {
      observer.observe(el);
    });
    
    return () => observer.disconnect();
  }, []);

  // Theme Logic
  useEffect(() => {
    const currentMode = localStorage.getItem('Oxlo-voxvision_theme') || 'system';
    setThemeMode(currentMode);
    applyTheme(currentMode);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (localStorage.getItem('Oxlo-voxvision_theme') === 'system' || !localStorage.getItem('Oxlo-voxvision_theme')) {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const applyTheme = (mode: string) => {
    const isDark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
      html.classList.remove('light');
    } else {
      html.classList.add('light');
      html.classList.remove('dark');
    }
  };

  const toggleTheme = () => {
    const modes = ['system', 'dark', 'light'];
    const currentIndex = modes.indexOf(themeMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setThemeMode(nextMode);
    localStorage.setItem('Oxlo-voxvision_theme', nextMode);
    applyTheme(nextMode);
  };

  // Scroll spy logic
  useEffect(() => {
    const handleScroll = () => {
      const navLinks = document.querySelectorAll('.nav-scroll-link');
      const sections = Array.from(navLinks).map(link => document.querySelector(link.getAttribute('href') || ''));
      let currentActive = null;
      let scrollY = window.scrollY;

      sections.forEach(section => {
        if (!section) return;
        const sectionTop = (section as HTMLElement).offsetTop - 150;
        if (scrollY >= sectionTop) {
          currentActive = section.getAttribute('id');
        }
      });
      if (currentActive) setActiveSection(currentActive);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const getThemeIconProps = () => {
    switch (themeMode) {
        case 'system': return { icon: 'brightness_auto', class: 'text-slate-400' };
        case 'dark': return { icon: 'dark_mode', class: 'text-blue-400' };
        case 'light': return { icon: 'light_mode', class: 'text-amber-500' };
        default: return { icon: 'brightness_auto', class: 'text-slate-400' };
    }
  };

  return (
    <div className="relative bg-surface text-text-primary min-h-screen">
      

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  TOP NAV BAR                                                       */}
{/*  ════════════════════════════════════════════════════════════════  */}
<nav id="top-nav" className="fixed top-0 w-full z-50 flex justify-between items-center h-16 px-6 md:px-8 mx-auto" style={{ background: 'rgba(5,7,13,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,170,255,0.08)' }}>
    <div className="flex items-center gap-8">
        {/*  Logo  */}
        <a href="#" className="flex items-center gap-3 group">
            <img src="/logo-icon.png" alt="Oxlo-voxvision.ai Logo" className="h-9 w-auto logo-glow transition-all duration-300 group-hover:scale-110" />
            <div>
                <span className="text-lg font-bold leading-tight text-text-primary">
                    <span className="text-accent">Oxlo-voxvision.ai</span>
                </span>
            </div>
        </a>

        {/*  Nav Links (Desktop)  */}
        <div className="hidden md:flex items-center gap-6">
            {[
              { href: '#features', label: 'Features', id: 'features' },
              { href: '#how-it-works', label: 'How It Works', id: 'how-it-works' },
              { href: '#models', label: 'Models', id: 'models' },
              { href: '#use-cases', label: 'Use Cases', id: 'use-cases' },
            ].map(({ href, label, id }) => (
              <a
                key={id}
                className={`nav-scroll-link text-sm transition-colors duration-200 cursor-pointer ${
                  activeSection === id ? 'text-accent font-semibold' : 'text-slate-400 hover:text-accent'
                }`}
                href={href}
              >{label}</a>
            ))}
        </div>
    </div>
    <div className="flex items-center gap-4">
        <span className="hidden lg:inline text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Built for <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="text-accent/70 hover:text-accent transition-colors">Oxlo.ai Hackathon</a>
        </span>
        {/*  LinkedIn Nav Icon  */}
        <a href="https://www.linkedin.com/in/pavithrahn56/" target="_blank" rel="noopener noreferrer" className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-slate-500 hover:text-accent transition-colors" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.08)' }} title="LinkedIn">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
        {/*  GitHub Nav Icon  */}
        <a href="https://github.com/pavithra-hn/-Oxlo-voxvision.ai" target="_blank" rel="noopener noreferrer" className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-slate-500 hover:text-accent transition-colors" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.08)' }} title="GitHub">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        </a>

        {/*  Theme Toggle Button  */}
        <button id="theme-toggle" className="flex w-9 h-9 rounded-lg items-center justify-center overflow-hidden text-slate-400 hover:text-accent transition-colors shrink-0" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.08)' }} title={`Theme: ${themeMode}`} onClick={toggleTheme}>
            <span id="theme-icon" className={`material-symbols-outlined ${getThemeIconProps().class}`} style={{ fontSize: '20px' }}>{getThemeIconProps().icon}</span>
        </button>

        <Link to="/voice" className="bg-accent text-surface px-5 py-2 rounded-xl font-bold text-sm hover:shadow-[0_0_25px_rgba(0,170,255,0.35)] transition-all active:scale-95">
            Launch App
        </Link>
        {/*  Mobile Menu Button  */}
        <button id="mobile-menu-btn" className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-accent transition-colors" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.08)' }} onClick={() => document.getElementById('mobile-menu')?.classList.toggle('hidden')}>
            <span className="material-symbols-outlined text-xl">menu</span>
        </button>
    </div>
</nav>
{/*  Mobile Menu Dropdown  */}
<div id="mobile-menu" className="hidden fixed top-16 left-0 right-0 z-40 px-6 py-4 md:hidden" style={{ background: 'rgba(5,7,13,0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,170,255,0.1)' }}>
    <div className="flex flex-col gap-4">
        <a className="text-sm font-semibold text-accent py-2" href="#features" onClick={() => document.getElementById('mobile-menu')?.classList.add('hidden')}>Features</a>
        <a className="text-sm text-slate-400 hover:text-accent py-2" href="#how-it-works" onClick={() => document.getElementById('mobile-menu')?.classList.add('hidden')}>How It Works</a>
        <a className="text-sm text-slate-400 hover:text-accent py-2" href="#models" onClick={() => document.getElementById('mobile-menu')?.classList.add('hidden')}>Models</a>
        <a className="text-sm text-slate-400 hover:text-accent py-2" href="#use-cases" onClick={() => document.getElementById('mobile-menu')?.classList.add('hidden')}>Use Cases</a>
        <a href="https://github.com/pavithra-hn/-Oxlo-voxvision.ai" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-accent py-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
        </a>
        <a href="https://www.linkedin.com/in/pavithrahn56/" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-accent py-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            LinkedIn
        </a>
        <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-accent py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">api</span>
            Oxlo.ai Platform
        </a>
    </div>
</div>

<main className="pt-16 relative z-10">

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  HERO SECTION                                                       */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section id="hero" className="relative min-h-[100vh] flex items-center justify-center overflow-hidden px-6 md:px-8">
    {/*  Background  */}
    <div className="absolute inset-0 z-0">
        <div className="w-full h-full opacity-30 bg-[radial-gradient(ellipse_at_50%_40%,_rgba(0,170,255,0.2)_0%,_transparent_65%)]"></div>
        <img className="w-full h-full object-cover mix-blend-screen opacity-20" src="/hero-bg.png" alt="Neural network hero background" />
    </div>

    {/*  Floating Particles (decorative)  */}
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute w-2 h-2 rounded-full bg-accent/30 top-[20%] left-[15%] animate-float" style={{ animationDelay: '0s' }}></div>
        <div className="absolute w-1.5 h-1.5 rounded-full bg-teal/30 top-[60%] left-[80%] animate-float" style={{ animationDelay: '1s' }}></div>
        <div className="absolute w-1 h-1 rounded-full bg-accent/20 top-[40%] left-[70%] animate-float" style={{ animationDelay: '2s' }}></div>
        <div className="absolute w-2.5 h-2.5 rounded-full bg-accent/20 top-[75%] left-[25%] animate-float" style={{ animationDelay: '1.5s' }}></div>
        <div className="absolute w-1 h-1 rounded-full bg-teal/25 top-[30%] left-[55%] animate-float" style={{ animationDelay: '0.5s' }}></div>
    </div>

    {/*  Content  */}
    <div className="relative z-10 max-w-5xl text-center">
        {/*  Status Badge  */}
        <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8 animate-fade-in-up hover:border-accent/30 transition-colors" style={{ background: 'rgba(0,170,255,0.06)', border: '1px solid rgba(0,170,255,0.15)' }}>
            <span className="w-2 h-2 rounded-full bg-teal animate-pulse"></span>
            <span className="text-[11px] font-bold tracking-[0.15em] uppercase text-text-secondary">Oxlo.ai Hackathon Project</span>
        </a>

        {/*  Logo Float with Blink Animation  */}
        <div className="flex justify-center mb-8 animate-fade-in-up delay-100">
            <div className="relative inline-block">
                <img src="/logo-icon.png" alt="Oxlo-voxvision Logo" className="h-24 md:h-32 w-auto animate-eye-blink" />
                <div className="eye-blink-line"></div>
            </div>
        </div>

        {/*  Headline  */}
        <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tight text-text-primary mb-6 leading-[1.08] animate-fade-in-up delay-200">
            See. Hear. Speak.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-teal">Generate.</span>
        </h1>

        {/*  Subhead  */}
        <p className="text-base sm:text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed font-light animate-fade-in-up delay-300">
            Oxlo-voxvision.ai merges real-time computer vision, multilingual voice interaction, and AI image generation into a single multimodal assistant, powered by the <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="text-accent/80 font-semibold hover:text-accent transition-colors">Oxlo.ai multi-model API</a>.
        </p>

        {/*  CTA Buttons  */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up delay-400">
            <Link to="/voice" className="btn-pill btn-pill-primary text-surface px-10 py-4 text-lg font-bold w-full sm:w-auto text-center">
                Try Oxlo-voxvision.ai
            </Link>
            <a href="#features" className="btn-pill btn-pill-secondary px-10 py-4 text-lg font-semibold w-full sm:w-auto text-center">
                Explore Features
            </a>
        </div>

        {/*  Model Chips  */}
        <div className="flex flex-wrap justify-center gap-2 mt-12 animate-fade-in-up delay-500">
            <span className="model-chip">Kimi K2.5</span>
            <span className="model-chip">Qwen 3 32B</span>
            <span className="model-chip">DeepSeek R1 70B</span>
            <span className="model-chip">Llama 4 Maverick</span>
            <span className="model-chip">Ministral 14B</span>
            <span className="model-chip">Kokoro 82M</span>
            <span className="model-chip">YOLOv11</span>
            <span className="model-chip">Oxlo Image Pro</span>
            <span className="model-chip">FLUX.1 Schnell</span>
            <span className="model-chip">Sarvam Saaras v3</span>
            <span className="model-chip">Groq Whisper</span>
            <span className="model-chip">gTTS</span>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  LANGUAGE SUPPORT STRIP                                             */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section className="py-12 overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(0,229,160,0.06)', borderBottom: '1px solid rgba(0,229,160,0.06)' }}>
    <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="flex items-center justify-center gap-3 mb-6">
            <span className="material-symbols-outlined text-teal/60 text-lg">translate</span>
            <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-center text-slate-600">Multilingual Support · 8 Languages · Native Script Output</p>
        </div>
        <div className="flex flex-wrap justify-center items-center gap-3">
            <span className="lang-pill">🇬🇧 English</span>
            <span className="lang-pill">🇮🇳 हिन्दी</span>
            <span className="lang-pill">🇮🇳 ಕನ್ನಡ</span>
            <span className="lang-pill">🇮🇳 தமிழ்</span>
            <span className="lang-pill">🇮🇳 తెలుగు</span>
            <span className="lang-pill">🇪🇸 Español</span>
            <span className="lang-pill">🇫🇷 Français</span>
            <span className="lang-pill">🇯🇵 日本語</span>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  FEATURES BENTO GRID                                                */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section id="features" className="py-24 md:py-32 px-6 md:px-8 max-w-7xl mx-auto">
    <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
        <div className="max-w-2xl">
            <span className="text-accent font-bold tracking-widest text-xs uppercase mb-4 block">Core Capabilities</span>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-text-primary">Four Modalities.<br/>One Interface.</h2>
        </div>
        <div className="text-slate-400 text-sm font-medium border-l border-accent/15 pl-6 max-w-xs leading-relaxed">
            Voice, vision, text, and image generation, unified through a single Oxlo.ai API key with an OpenAI-compatible endpoint.
        </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

        {/*  ── Voice Mode Card (Large) ────────────────────────────  */}
        <div className="md:col-span-8 glass-card rounded-2xl overflow-hidden group">
            <div className="p-8 md:p-10 flex flex-col h-full">
                <div className="mb-auto">
                    <div className="w-12 h-12 rounded-xl feature-icon flex items-center justify-center mb-6">
                        <span className="material-symbols-outlined text-accent text-2xl">mic</span>
                    </div>
                    <h3 className="text-2xl md:text-3xl font-bold mb-3 text-text-primary">Voice Mode</h3>
                    <p className="text-slate-400 leading-relaxed max-w-lg text-sm">
                        Full-duplex voice assistant with hold-to-speak recording, dual-engine STT (Sarvam AI + Groq Whisper), anti-hallucination LLM responses, compound image generation, and language-aware TTS routing. Kokoro for English, gTTS for Indic languages.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                        <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(0,229,160,0.08)', color: 'rgba(0,229,160,0.8)' }}>Anti-Hallucination</span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(0,170,255,0.08)', color: 'rgba(0,170,255,0.8)' }}>Compound Requests</span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(0,170,255,0.08)', color: 'rgba(0,170,255,0.8)' }}>Intent Classification</span>
                        <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ background: 'rgba(168,85,247,0.08)', color: 'rgba(168,85,247,0.8)' }}>🎨 Image Generation</span>
                    </div>
                </div>
                {/*  Voice Waveform Visualization  */}
                <div className="mt-10 p-6 rounded-xl" style={{ background: 'rgba(0,170,255,0.04)', border: '1px solid rgba(0,170,255,0.08)' }}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                            <span className="material-symbols-outlined text-accent text-lg">graphic_eq</span>
                        </div>
                        <span className="text-xs font-semibold text-accent/70 uppercase tracking-wider">Live Pipeline</span>
                    </div>
                    <div className="space-y-2.5">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-semibold text-slate-500 w-8">STT</span>
                            <div className="h-1.5 bg-surface-mid rounded-full overflow-hidden flex-1">
                                <div className="h-full bg-gradient-to-r from-accent to-teal rounded-full wave-bar"></div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-semibold text-slate-500 w-8">LLM</span>
                            <div className="h-1.5 bg-surface-mid rounded-full overflow-hidden flex-1">
                                <div className="h-full bg-gradient-to-r from-accent to-teal rounded-full wave-bar"></div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-semibold text-purple-500/60 w-8">IMG</span>
                            <div className="h-1.5 bg-surface-mid rounded-full overflow-hidden flex-1">
                                <div className="h-full bg-gradient-to-r from-purple-500 to-accent rounded-full wave-bar"></div>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-semibold text-slate-500 w-8">TTS</span>
                            <div className="h-1.5 bg-surface-mid rounded-full overflow-hidden flex-1">
                                <div className="h-full bg-gradient-to-r from-teal to-accent rounded-full wave-bar"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/*  ── Vision Mode Card ──────────────────────────────────  */}
        <div className="md:col-span-4 glass-card rounded-2xl p-8 md:p-10 flex flex-col">
            <div className="w-12 h-12 rounded-xl feature-icon flex items-center justify-center mb-6">
                <span className="material-symbols-outlined text-accent text-2xl">visibility</span>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-3 text-text-primary">Vision Mode</h3>
            <p className="text-slate-400 leading-relaxed text-sm mb-6">
                Live webcam AI that greets you by appearance, answers visual questions, generates images from your camera, and intelligently routes between vision, image gen, and text chat.
            </p>
            <div className="mt-auto space-y-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="material-symbols-outlined text-teal text-base">check_circle</span>
                    Personalized visual greeting
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="material-symbols-outlined text-teal text-base">check_circle</span>
                    Smart Intent Router (Vision / Image / Voice)
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="material-symbols-outlined text-teal text-base">check_circle</span>
                    🎨 Image Generation (anime, cartoon, styles)
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="material-symbols-outlined text-teal text-base">check_circle</span>
                    YOLOv11 object detection
                </div>
            </div>
        </div>

        {/*  ── Creative Features + Image Gen Card ────────────────────────────  */}
        <div className="md:col-span-4 glass-card rounded-2xl p-8 md:p-10 flex flex-col">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6" style={{ background: 'linear-gradient(135deg, rgba(0,229,160,0.15), rgba(0,229,160,0.05))', border: '1px solid rgba(0,229,160,0.15)' }}>
                <span className="material-symbols-outlined text-teal text-2xl">auto_awesome</span>
            </div>
            <h3 className="text-2xl md:text-3xl font-bold mb-3 text-text-primary">Creative Vision</h3>
            <p className="text-slate-400 leading-relaxed text-sm mb-8">
                Four AI-powered creative features that transform your camera into a creative studio.
            </p>
            <div className="space-y-4 mt-auto">
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,170,255,0.04)', border: '1px solid rgba(0,170,255,0.08)' }}>
                    <span className="text-xs font-bold text-accent/90">🎨 Image Generation</span>
                    <p className="text-[11px] text-slate-500 mt-1">"Make me anime" — detects your face, generates styled portrait</p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,229,160,0.04)', border: '1px solid rgba(0,229,160,0.08)' }}>
                    <span className="text-xs font-bold text-teal/90">🌊 What If</span>
                    <p className="text-[11px] text-slate-500 mt-1">Reimagine any scene: "What if this was underwater?"</p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,229,160,0.04)', border: '1px solid rgba(0,229,160,0.08)' }}>
                    <span className="text-xs font-bold text-teal/90">📖 Biographies</span>
                    <p className="text-[11px] text-slate-500 mt-1">AI-written origin stories for any detected object</p>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(0,229,160,0.04)', border: '1px solid rgba(0,229,160,0.08)' }}>
                    <span className="text-xs font-bold text-teal/90">🎬 Director</span>
                    <p className="text-[11px] text-slate-500 mt-1">Turns your camera view into a movie poster</p>
                </div>
            </div>
        </div>

        {/*  ── Architecture Card (Wide) ──────────────────────────  */}
        <div className="md:col-span-8 glass-card rounded-2xl overflow-hidden flex flex-col md:flex-row items-stretch">
            <div className="p-8 md:p-10 md:w-1/2 flex flex-col justify-center">
                <h3 className="text-2xl md:text-3xl font-bold mb-4 text-text-primary">One API. All Models.</h3>
                <p className="text-slate-400 leading-relaxed text-sm mb-6">
                    The entire system (Kimi K2.5, Qwen 3, Kokoro 82M, YOLOv11, FLUX.1 Schnell, and Oxlo Image Pro) runs through a single <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="text-accent/80 font-semibold hover:text-accent transition-colors">Oxlo.ai API key</a> with an OpenAI-compatible endpoint. No stitching. No multi-provider chaos.
                </p>
                <ul className="space-y-2.5">
                    <li className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="material-symbols-outlined text-accent text-base">bolt</span>
                        Parallel async processing
                    </li>
                    <li className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="material-symbols-outlined text-accent text-base">sync</span>
                        Rate-limit aware model fallback
                    </li>
                    <li className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="material-symbols-outlined text-accent text-base">speed</span>
                        Sub-100ms vision latency
                    </li>
                </ul>
            </div>
            <div className="md:w-1/2 min-h-[280px] relative">
                <img className="w-full h-full object-cover" src="/architecture-globe.png" alt="Global AI infrastructure network" />
                <div className="absolute inset-0 bg-gradient-to-r from-surface-dim via-transparent to-transparent"></div>
            </div>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  HOW IT WORKS                                                       */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section id="how-it-works" className="py-24 md:py-32 px-6 md:px-8" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 100%)' }}>
    <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
            <span className="text-accent font-bold tracking-widest text-xs uppercase mb-4 block">Pipeline Architecture</span>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-text-primary">How It Works</h2>
        </div>

        {/*  Voice Pipeline Steps  */}
        <div className="mb-16">
            <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
                    <span className="material-symbols-outlined text-accent text-xl">mic</span>
                </div>
                <h3 className="text-xl font-bold text-text-primary">Voice Pipeline</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="glass-card rounded-xl p-6">
                    <div className="text-accent/40 text-4xl font-black mb-3">01</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Capture Audio</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Hold-to-speak mic records WebM audio in the browser via MediaRecorder API.</p>
                </div>
                <div className="glass-card rounded-xl p-6">
                    <div className="text-accent/40 text-4xl font-black mb-3">02</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Dual-Engine STT</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Sarvam Saaras v3 primary (Indic-optimized) + Groq Whisper fallback with quality arbitration.</p>
                </div>
                <div className="glass-card rounded-xl p-6">
                    <div className="text-accent/40 text-4xl font-black mb-3">03</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">LLM + Validation</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Qwen 3 32B generates response. Anti-hallucination system validates & retries up to 2x.</p>
                </div>
                <div className="glass-card rounded-xl p-6" style={{ border: '1px solid rgba(168,85,247,0.15)', background: 'rgba(168,85,247,0.03)' }}>
                    <div className="text-purple-400/40 text-4xl font-black mb-3">04</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Image Generation</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">For compound requests, Oxlo Image Pro generates an image in parallel with structured text.</p>
                </div>
                <div className="glass-card rounded-xl p-6">
                    <div className="text-accent/40 text-4xl font-black mb-3">05</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">TTS Playback</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Kokoro 82M for English, gTTS for Indic. Language-aware routing ensures native pronunciation.</p>
                </div>
            </div>
        </div>

        {/*  Vision Pipeline Steps (Updated with Intent Router + Image Gen)  */}
        <div>
            <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
                    <span className="material-symbols-outlined text-accent text-xl">visibility</span>
                </div>
                <h3 className="text-xl font-bold text-text-primary">Vision Pipeline</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="glass-card rounded-xl p-6">
                    <div className="text-teal/40 text-4xl font-black mb-3">01</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Camera Opens</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Browser requests webcam, 1.5s warm-up, then auto-captures the first frame for greeting analysis.</p>
                </div>
                <div className="glass-card rounded-xl p-6">
                    <div className="text-teal/40 text-4xl font-black mb-3">02</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">AI Greeting</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Vision LLM analyzes your appearance (clothing, expression, environment) and speaks a personalized greeting.</p>
                </div>
                <div className="glass-card rounded-xl p-6" style={{ border: '1px solid rgba(0,170,255,0.15)', background: 'rgba(0,170,255,0.03)' }}>
                    <div className="text-accent/40 text-4xl font-black mb-3">03</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Intent Router</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Hybrid keyword+regex router classifies intent into: <span className="text-accent font-semibold">Vision</span>, <span className="text-accent font-semibold">Image Gen</span>, or <span className="text-accent font-semibold">Text Chat</span>.</p>
                </div>
                <div className="glass-card rounded-xl p-6" style={{ border: '1px solid rgba(0,229,160,0.15)', background: 'rgba(0,229,160,0.03)' }}>
                    <div className="text-teal/40 text-4xl font-black mb-3">04</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">🎨 Image Generation</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Camera frame sent directly to <span className="text-teal font-semibold">Oxlo Image Pro</span> via img2img (<code className="text-[10px]">/v1/images/edits</code>). Fallback: <span className="text-slate-400">FLUX.1 Schnell</span>. 17 style presets with optimized strength values.</p>
                </div>
                <div className="glass-card rounded-xl p-6">
                    <div className="text-teal/40 text-4xl font-black mb-3">05</div>
                    <h4 className="text-sm font-bold text-text-primary mb-2">Render + Speak</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">Generated image renders in chat with download/regenerate actions. YOLOv11 detections overlay on the live feed.</p>
                </div>
            </div>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  MODELS & TECH STACK                                                */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section id="models" className="py-24 md:py-32 px-6 md:px-8 max-w-7xl mx-auto">
    <div className="text-center mb-20">
        <span className="text-accent font-bold tracking-widest text-xs uppercase mb-4 block">Architecture & Workflows</span>
        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-text-primary">System AI Roadmaps</h2>
        <p className="text-slate-400 text-sm mt-4 max-w-xl mx-auto">Discover how multimodal inputs move through specialized AI engines in real-time, routed efficiently via Oxlo.ai and external networks.</p>
    </div>

    {/*  1. VOICE ASSISTANT ROADMAP  */}
    <div className="mb-24">
        <h3 className="text-xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent"><span className="material-symbols-outlined text-sm">record_voice_over</span></span>
            Voice Assistant Pipeline
        </h3>
        
        {/*  Desktop Horizontal / Mobile Vertical Flex  */}
        <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-4 justify-between w-full relative">
            
            {/*  Step 1: Input  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-48 text-center flex flex-col items-center justify-center z-10 shrink-0">
                <span className="material-symbols-outlined text-slate-400 text-3xl mb-2">mic</span>
                <div className="text-sm font-bold text-white">Audio Input</div>
                <div className="text-[10px] text-slate-500 mt-1">Native Language Speech</div>
            </div>

            {/*  Arrow 1: Input → STT  */}
            <div className="hidden lg:flex items-center justify-center text-slate-400">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-slate-400 my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 2: STT  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-56 flex flex-col justify-center z-10 shrink-0 border border-slate-800">
                <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-3 text-center">Speech to Text</div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-white/5 relative">
                    <div className="text-xs font-bold text-white mb-0.5">Sarvam Saaras v3</div>
                    <div className="text-[9px] text-slate-400">Primary Indic STT</div>
                </div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-white/5 mt-2 opacity-60">
                    <div className="text-xs font-bold text-white mb-0.5">Groq Whisper</div>
                    <div className="text-[9px] text-slate-400">Fallback English STT</div>
                </div>
            </div>

            {/*  Arrow 2: STT → LLM  */}
            <div className="hidden lg:flex items-center justify-center text-accent">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-accent my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 3: LLM + Image Gen  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-56 flex flex-col justify-center z-10 shrink-0 border border-accent/20 bg-accent/[0.02]">
                <div className="text-[9px] uppercase tracking-wider text-accent font-bold mb-3 text-center">Inference Engine</div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-accent/20 relative">
                    <div className="absolute -top-2.5 -right-2 bg-accent text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,170,255,0.4)]">Oxlo.ai API</div>
                    <div className="text-sm font-bold text-white mb-0.5 mt-1">Qwen 3 32B</div>
                    <div className="text-[9px] text-slate-400">Low-Latency Language Core</div>
                </div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-purple-500/20 mt-2 relative">
                    <div className="absolute -top-2.5 -right-2 bg-purple-500 text-white text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(168,85,247,0.4)]">Compound</div>
                    <div className="text-xs font-bold text-white mb-0.5 mt-1">Oxlo Image Pro</div>
                    <div className="text-[9px] text-slate-400">Parallel Image Generation</div>
                </div>
                <div className="mt-3 text-[10px] text-slate-500 text-center leading-tight">
                    Compound requests generate both image + structured text in parallel.
                </div>
            </div>

            {/*  Arrow 3: LLM → TTS  */}
            <div className="hidden lg:flex items-center justify-center text-teal">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-teal my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 4: TTS  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-56 flex flex-col justify-center z-10 shrink-0 border border-teal/20 bg-teal/[0.02]">
                <div className="text-[9px] uppercase tracking-wider text-teal font-bold mb-3 text-center">Text to Speech</div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-teal/20 relative">
                    <div className="absolute -top-2.5 -right-2 bg-teal text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,229,160,0.4)]">Oxlo.ai API</div>
                    <div className="text-xs font-bold text-white mb-0.5 mt-1">Kokoro 82M</div>
                    <div className="text-[9px] text-slate-400">English Neural Synthesis</div>
                </div>
                <div className="bg-[#0A0D15] rounded-lg p-3 text-center border border-white/5 mt-2 opacity-60">
                    <div className="text-xs font-bold text-white mb-0.5">gTTS API</div>
                    <div className="text-[9px] text-slate-400">Indic Translation TTS</div>
                </div>
            </div>

            {/*  Arrow 4: TTS → Playback  */}
            <div className="hidden lg:flex items-center justify-center text-slate-400">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-slate-400 my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 5: Output  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-32 text-center flex flex-col items-center justify-center z-10 shrink-0">
                <span className="material-symbols-outlined text-slate-400 text-3xl mb-2">speaker</span>
                <div className="text-sm font-bold text-white">Playback</div>
            </div>
        </div>
    </div>

    {/*  2. VISION ASSISTANT ROADMAP  */}
    <div className="mt-20">
        <h3 className="text-xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-teal/20 flex items-center justify-center text-teal"><span className="material-symbols-outlined text-sm">visibility</span></span>
            Vision Assistant Pipeline
        </h3>
        
        <div className="flex flex-col lg:flex-row items-center lg:items-stretch gap-4 justify-between w-full relative">
            
            {/*  Step 1: Input  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-48 text-center flex flex-col items-center justify-center z-10 shrink-0">
                <span className="material-symbols-outlined text-slate-400 text-3xl mb-2">videocam</span>
                <div className="text-sm font-bold text-white">Webcam Stream</div>
                <div className="text-[10px] text-slate-500 mt-1">Live frame capture</div>
            </div>

            {/*  Arrow: Webcam → AI Models  */}
            <div className="hidden lg:flex items-center justify-center text-teal shrink-0">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-teal my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 2: Parallel AI Processing (Stacked)  */}
            <div className="w-full lg:flex-1 flex flex-col gap-3 z-10 shrink-0 relative">
                {/*  Parallel badge  */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
                    <span className="text-[9px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(0,170,255,0.12)', border: '1px solid rgba(0,170,255,0.2)', color: 'rgba(0,170,255,0.8)' }}>Parallel Processing</span>
                </div>
                {/*  YOLO  */}
                <div className="glass-card rounded-xl p-4 flex items-center gap-4 border border-teal/20 bg-teal/[0.02]">
                    <div className="w-12 h-12 bg-[#0A0D15] rounded-xl flex items-center justify-center shrink-0 border border-teal/20 relative">
                        <span className="material-symbols-outlined text-teal text-xl">center_focus_strong</span>
                    </div>
                    <div className="flex-1 text-left relative">
                        <div className="absolute right-0 top-0 bg-teal text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,229,160,0.4)]">Oxlo.ai API</div>
                        <div className="text-sm font-bold text-white pr-16 mt-0.5">YOLOv11</div>
                        <div className="text-[10px] text-slate-400">Object Detection Bounding Boxes</div>
                    </div>
                </div>

                {/*  Vision LLM  */}
                <div className="glass-card rounded-xl p-4 flex items-center gap-4 border border-accent/20 bg-accent/[0.02]">
                    <div className="w-12 h-12 bg-[#0A0D15] rounded-xl flex items-center justify-center shrink-0 border border-accent/20">
                        <span className="material-symbols-outlined text-accent text-xl">psychology</span>
                    </div>
                    <div className="flex-1 text-left relative">
                        <div className="absolute right-0 top-0 bg-accent text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,170,255,0.4)]">Oxlo.ai API</div>
                        <div className="text-sm font-bold text-white pr-16 mt-0.5">Kimi K2.5 Vision</div>
                        <div className="text-[10px] text-slate-400">Scene Context &amp; Greeting Analysis</div>
                    </div>
                </div>

                {/*  Image Generation  */}
                <div className="glass-card rounded-xl p-4 flex items-center gap-4 border border-purple-500/20 bg-purple-500/[0.02]">
                    <div className="w-12 h-12 bg-[#0A0D15] rounded-xl flex items-center justify-center shrink-0 border border-purple-500/20">
                        <span className="material-symbols-outlined text-purple-400 text-xl">palette</span>
                    </div>
                    <div className="flex-1 text-left relative">
                        <div className="absolute right-0 top-0 bg-purple-500 text-white text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(168,85,247,0.4)]">img2img</div>
                        <div className="text-sm font-bold text-white pr-16 mt-0.5">Oxlo Image Pro</div>
                        <div className="text-[10px] text-slate-400">Camera → Styled Image (anime, cartoon, etc.)</div>
                    </div>
                </div>
            </div>

            {/*  Arrow: AI Models → Compound Context  */}
            <div className="hidden lg:flex items-center justify-center text-accent shrink-0">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-accent my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>

            {/*  Step 3: Synthesis  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-44 text-center flex flex-col items-center justify-center z-10 shrink-0">
                <span className="material-symbols-outlined text-accent text-3xl mb-2">join_inner</span>
                <div className="text-sm font-bold text-white">Compound Context</div>
                <div className="text-[10px] text-slate-500 mt-1">Merged JSON Response</div>
            </div>

            {/*  Arrow: Compound Context → Live UI Output  */}
            <div className="hidden lg:flex items-center justify-center text-slate-400 shrink-0">
                <span className="material-symbols-outlined text-3xl">arrow_right_alt</span>
            </div>
            <div className="lg:hidden text-slate-400 my-2 flex justify-center">
                <span className="material-symbols-outlined">arrow_downward</span>
            </div>


            {/*  Step 4: Output  */}
            <div className="glass-card rounded-xl p-5 w-full lg:w-32 text-center flex flex-col items-center justify-center z-10 shrink-0 border border-white/5">
                <span className="material-symbols-outlined text-green-400 text-3xl mb-2">display_settings</span>
                <div className="text-sm font-bold text-white">Live UI Output</div>
            </div>

        </div>
    </div>

    {/*  3. GENERAL TEXT / IMAGE ROADMAP  */}
    <div className="mt-20 border-t border-white/5 pt-16">
        <h3 className="text-xl font-bold text-white mb-8 flex items-center justify-center lg:justify-start gap-3">
            <span className="w-8 h-8 rounded-full bg-slate-800/50 flex items-center justify-center text-slate-400"><span className="material-symbols-outlined text-sm">hub</span></span>
            General Capabilities (Standard APIs)
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full lg:w-3/4">
            {/*  Text Chat LLM  */}
            <div className="glass-card rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-accent">chat</span>
                </div>
                <div className="w-full">
                    <div className="flex justify-between items-start w-full">
                        <h4 className="text-sm font-bold text-text-primary">Text Inference</h4>
                        <span className="bg-accent text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,170,255,0.4)]">Oxlo.ai API</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-300 mt-2">Kimi K2.5 <span className="text-slate-600 font-normal ml-2">Primary Gen Chat</span></div>
                    <div className="text-[10px] text-slate-500 mt-1">Fallback: DeepSeek R1 70B, Llama 4</div>
                </div>
            </div>

            {/*  Image Generation  */}
            <div className="glass-card rounded-xl p-5 flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-teal">image</span>
                </div>
                <div className="w-full">
                    <div className="flex justify-between items-start w-full">
                        <h4 className="text-sm font-bold text-text-primary">Image Generation</h4>
                        <span className="bg-teal text-[#05070D] text-[8px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-widest shadow-[0_0_10px_rgba(0,229,160,0.4)]">Oxlo.ai API</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-300 mt-2">Oxlo Image Pro <span className="text-slate-600 font-normal ml-2">Text-to-Image + img2img</span></div>
                    <div className="text-[10px] text-slate-500 mt-1">Fallback: FLUX.1 Schnell · 17 style presets</div>
                </div>
            </div>
        </div>
    </div>
</section>


{/*  ════════════════════════════════════════════════════════════════  */}
{/*  USE CASES                                                          */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section id="use-cases" className="py-24 md:py-32 px-6 md:px-8" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 100%)' }}>
    <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
            <span className="text-teal font-bold tracking-widest text-xs uppercase mb-4 block">Real-World Applications</span>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-text-primary">Built For Real People</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-accent" style={{ textShadow: '0 0 20px rgba(0,170,255,0.4)' }}>mic</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Personal Assistant</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Hands-free voice assistant in English, Hindi, Kannada, Tamil, or Telugu. Ask anything, get recipes with steps, or have a natural conversation.</p>
            </div>
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-teal" style={{ textShadow: '0 0 20px rgba(0,229,160,0.4)' }}>checkroom</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Outfit & Interview Check</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Open the camera before a meeting. The AI sees you and gives honest feedback on your outfit, grooming, and presentation.</p>
            </div>
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-accent" style={{ textShadow: '0 0 20px rgba(0,170,255,0.4)' }}>restaurant_menu</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Cooking Assistance</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Point your camera at ingredients and ask "What can I cook with these?" The Vision LLM identifies items and suggests recipes.</p>
            </div>
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-teal" style={{ textShadow: '0 0 20px rgba(0,229,160,0.4)' }}>accessible</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Accessibility</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Voice-first design with visual awareness. Point at objects, labels, or text and ask "What does this say?" to get spoken descriptions.</p>
            </div>
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-accent" style={{ textShadow: '0 0 20px rgba(0,170,255,0.4)' }}>school</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Education</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Students ask academic questions in their native language (ಕನ್ನಡ, தமிழ், తెలుగు, हिन्दी) and receive answers in native script, never transliterated.</p>
            </div>
            <div className="glass-card rounded-2xl p-7">
                <span className="material-symbols-outlined text-[32px] mb-5 block text-teal" style={{ textShadow: '0 0 20px rgba(0,229,160,0.4)' }}>movie</span>
                <h4 className="text-base font-bold text-text-primary mb-2">Creative Content</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Transform any scene into cyberpunk art, generate movie posters from a room, or write fictional backstories for random objects.</p>
            </div>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  DIFFERENTIATORS                                                     */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section className="py-24 md:py-32 px-6 md:px-8 max-w-7xl mx-auto">
    <div className="text-center mb-16">
        <span className="text-accent font-bold tracking-widest text-xs uppercase mb-4 block">Why Oxlo-voxvision</span>
        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-text-primary">What Makes It Different</h2>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="glass-card rounded-2xl p-7 flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-1">
                <span className="material-symbols-outlined text-accent">visibility</span>
            </div>
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">It can actually see you</h4>
                <p className="text-xs text-slate-400 leading-relaxed">When you ask "How am I looking?", it looks at you through the webcam and responds based on what it actually sees. Not a generic answer.</p>
            </div>
        </div>
        <div className="glass-card rounded-2xl p-7 flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center shrink-0 mt-1">
                <span className="material-symbols-outlined text-teal">psychology</span>
            </div>
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">Knows when NOT to look</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Vision Intent Classifier runs in &lt;1ms. "What is 2+2?" skips the camera entirely, saving 2–5 seconds of latency per turn.</p>
            </div>
        </div>
        <div className="glass-card rounded-2xl p-7 flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-1">
                <span className="material-symbols-outlined text-accent">translate</span>
            </div>
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">Native script, never transliterated</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Kannada in ಕನ್ನಡ, Tamil in தமிழ், Telugu in తెలుగు, Hindi in हिन्दी. Both LLM output and TTS pronunciation are native.</p>
            </div>
        </div>
        <div className="glass-card rounded-2xl p-7 flex gap-4">
            <div className="w-10 h-10 rounded-lg bg-teal/10 flex items-center justify-center shrink-0 mt-1">
                <span className="material-symbols-outlined text-teal">verified</span>
            </div>
            <div>
                <h4 className="text-sm font-bold text-text-primary mb-1">Anti-hallucination with retries</h4>
                <p className="text-xs text-slate-400 leading-relaxed">Domain-specific grounding (no butter in tea), post-generation validation, and automatic regeneration up to 2x when quality checks fail.</p>
            </div>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  CTA SECTION                                                        */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section className="py-24 md:py-32 px-6 md:px-8">
    <div className="max-w-5xl mx-auto rounded-[2rem] p-10 md:p-20 text-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(0,170,255,0.15), rgba(0,229,160,0.08))', border: '1px solid rgba(0,170,255,0.2)' }}>
        {/*  Glow Effects  */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 blur-[100px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-teal/10 blur-[100px] rounded-full"></div>

        <div className="relative z-10">
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-black text-text-primary mb-6">Ready to see the future?</h2>
            <p className="text-base md:text-lg text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                Open the app, grant camera &amp; mic access, and start talking. Oxlo-voxvision.ai will hear you, see you, and respond in your language.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link to="/voice" className="btn-pill btn-pill-primary text-surface px-10 py-5 text-lg font-bold text-center">
                    Try Oxlo-voxvision.ai
                </Link>
                <a href="https://github.com/pavithra-hn/-Oxlo-voxvision.ai" target="_blank" rel="noopener noreferrer" className="btn-pill btn-pill-secondary px-10 py-5 text-lg font-semibold flex items-center justify-center gap-3">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                    View on GitHub
                </a>
            </div>
            {/*  Developer Social Link  */}
            <div className="flex items-center justify-center mt-6">
                <a href="https://www.linkedin.com/in/pavithrahn56/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-accent transition-all" style={{ background: 'rgba(0,170,255,0.04)', border: '1px solid rgba(0,170,255,0.1)' }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(0,170,255,0.25)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(0,170,255,0.1)'; }}>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    Connect on LinkedIn
                </a>
            </div>
        </div>
    </div>
</section>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  TECH STACK FOOTER STRIP                                            */}
{/*  ════════════════════════════════════════════════════════════════  */}
<section className="py-8 overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)', borderTop: '1px solid rgba(0,170,255,0.06)' }}>
    <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="flex flex-wrap justify-center items-center gap-6 text-[11px] font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">code</span> React 19
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">terminal</span> FastAPI 0.115
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">speed</span> Vite 8
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">palette</span> Tailwind CSS 4
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">code</span> TypeScript 5.9
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">animation</span> Framer Motion
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">code</span> Python 3.11
            </span>
            <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-accent/50 text-sm">hub</span> OpenAI SDK
            </span>
        </div>
    </div>
</section>

</main>

{/*  ════════════════════════════════════════════════════════════════  */}
{/*  FOOTER                                                             */}
{/*  ════════════════════════════════════════════════════════════════  */}
<footer className="w-full py-10 px-6 md:px-8" style={{ background: '#03050A', borderTop: '1px solid rgba(0,170,255,0.06)' }}>
    <div className="max-w-7xl mx-auto">
        {/*  Bottom row: Copyright  */}
        <div className="flex justify-center items-center">
            <p className="text-[11px] text-slate-600">
                © 2026 <a href="https://www.linkedin.com/in/pavithrahn56/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors font-medium">Pavithra H N</a> · Built for the <a href="https://portal.oxlo.ai/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">Oxlo.ai Hackathon</a>
            </p>
        </div>
    </div>
</footer>

{/*  Dynamic Intersection Observer Scripts  */}



    </div>
  );
};
export default LandingPage;
