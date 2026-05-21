import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Square, Send, AlertCircle, Trash2, Copy, ChevronRight, CheckSquare,
  Loader, Download, Check, Edit2, Clock, Zap, RotateCcw,
  Image as ImageIcon, X, Cpu, Volume2, Settings, Mic, ArrowDown,
  Phone, MessageSquare, Wand2, Save, ChevronLeft, Server
} from 'lucide-react';
import { QUICK_PROMPTS, wrapWithQuickPrompt } from '../data/quickPrompts';
import { useAI } from '../context/AIContext';
import type { AISession } from '../context/AIContext';
import Markdown from '../components/Markdown';
import AppBackground from '../components/AppBackground';
import AudioProcessingBar from '../components/AudioProcessingBar';
import { getWordAtCursor, InputAutocompleteMenu, type AutocompleteSuggestion } from '../components/InputAutocomplete';
import { searchAutocomplete } from '../lib/autocompleteEngine';
import { trackAudioElement, getSharedAnalyser } from '../lib/audioAnalyser';
import { voiceImageUrl } from '../lib/publicAssets';
import VoiceMessagePlayer from '../components/VoiceMessagePlayer';
import FlySendButton from '../components/FlySendButton';
import TypewriterPlaceholder from '../components/TypewriterPlaceholder';
import './AIPanel.css';

export { trackAudioElement };

const COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/settings', desc: 'Open settings page' },
  { cmd: '/clear', desc: 'Clear current chat' },
  { cmd: '/thinking', desc: 'Deep reasoning mode for one prompt' },
  { cmd: '/diagram', desc: 'Generate architecture diagram' },
  { cmd: '/plan', desc: 'Scaffold a full project' },
  { cmd: '/model', desc: 'Load/switch text model' },
  { cmd: '/model_vision', desc: 'Load/switch vision model' },
  { cmd: '/scale', desc: 'Set UI scale: /scale 10-200' },
  { cmd: '/white', desc: 'Switch to soft white theme' },
  { cmd: '/blur', desc: 'Toggle luxury blur background' },
  { cmd: '/wall', desc: 'Toggle wallpaper background' },
];

const VOICES = [
  { id: 'F1', label: 'Sofia', gender: 'Female', icon: 'S' },
  { id: 'F2', label: 'Luna', gender: 'Female', icon: 'L' },
  { id: 'F3', label: 'Aria', gender: 'Female', icon: 'A' },
  { id: 'F4', label: 'Mia', gender: 'Female', icon: 'M' },
  { id: 'F5', label: 'Zara', gender: 'Female', icon: 'Z' },
  { id: 'M1', label: 'James', gender: 'Male', icon: 'J' },
  { id: 'M2', label: 'Oliver', gender: 'Male', icon: 'O' },
  { id: 'M3', label: 'Ethan', gender: 'Male', icon: 'E' },
  { id: 'M4', label: 'Noah', gender: 'Male', icon: 'N' },
  { id: 'M5', label: 'Liam', gender: 'Male', icon: 'L' },
];
const VOICES_FEMALE = VOICES.filter((v) => v.id.startsWith('F'));
const VOICES_MALE = VOICES.filter((v) => v.id.startsWith('M'));

export default function AIPanel() {
  const {
    sessions, setSessions, currentSessionId, setCurrentSessionId,
    input, setInput, isStreaming, error, sendMessage,
    stopGeneration, clearChat, createNewSession, deleteSession, renameSession,
    selectedImage, setSelectedImage,
    thinkingMode, setThinkingMode, soundsEnabled, setSoundsEnabled,
    contextMemoryEnabled, setContextMemoryEnabled,
    setZoom
  } = useAI();

  const navigate = useNavigate();

  const [callModeActive, setCallModeActive] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isCallSpeaking, setIsCallSpeaking] = useState(false);
  const [quickPromptId, setQuickPromptId] = useState('none');
  const [showQuickPromptMenu, setShowQuickPromptMenu] = useState(false);
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const quickPromptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleAudioPlay = (e: any) => {
      const playing = !!e.detail.playing;
      setIsAudioPlaying(playing);
      if (playing) {
        setIsCallSpeaking(true);
      } else {
        setTimeout(() => {
          setIsCallSpeaking(isStreaming || callChunkQueueRef.current.length > 0 || callChunkPlayingRef.current);
        }, 50);
      }
    };
    window.addEventListener('ai-audio-play', handleAudioPlay);
    return () => {
      window.removeEventListener('ai-audio-play', handleAudioPlay);
    };
  }, [isStreaming]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setHistorySidebarOpen(!historySidebarOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historySidebarOpen]);

  useEffect(() => {
    if (callModeActive) {
      if (isStreaming) {
        setIsCallSpeaking(true);
      } else if (!isAudioPlaying && !callChunkPlayingRef.current && callChunkQueueRef.current.length === 0) {
        setIsCallSpeaking(false);
      }
    } else {
      setIsCallSpeaking(false);
    }
  }, [isStreaming, isAudioPlaying, callModeActive]);

  const [isConnecting, setIsConnecting] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [bootHint, setBootHint] = useState<'waiting' | 'ready' | 'idle'>('waiting');
  const [emptyChatLaunching, setEmptyChatLaunching] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const messages = currentSession ? currentSession.messages : [];

  const [isRunning, setIsRunning] = useState(false);
  const [connectionFlash, setConnectionFlash] = useState<'offline' | 'connecting' | 'online' | ''>('');
  const [lastConnectionState, setLastConnectionState] = useState<'offline' | 'connecting' | 'online'>('offline');
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [inputCursor, setInputCursor] = useState(0);
  const [wordAutocompleteIndex, setWordAutocompleteIndex] = useState(0);
  const [wordSuggestions, setWordSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const draftBeforeHistoryRef = useRef('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [planMode, setPlanMode] = useState(false);

  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [miniExpanded, setMiniExpanded] = useState(false);
  const [aiModelsList, setAiModelsList] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectionTTS, setSelectionTTS] = useState<{ text: string, top: number, left: number } | null>(null);
  const selectionAudioRef = useRef<HTMLAudioElement | null>(null);
  const selectionStopRef = useRef<boolean>(false);

  const [blurEnabled, setBlurEnabled] = useState(false);
  const [wallEnabled, setWallEnabled] = useState(false);
  const [currentWallpaper, setCurrentWallpaper] = useState('wallpaper.png');

  const [currentVoice, setCurrentVoice] = useState('F1');
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const [showRadialVoiceMenu, setShowRadialVoiceMenu] = useState(false);
  const radialVoiceMenuRef = useRef<HTMLDivElement>(null);
  const [selectedRadialVoice, setSelectedRadialVoice] = useState<string | null>(null);

  const [customDialog, setCustomDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  // STT Recording State
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const [showSTTConfirm, setShowSTTConfirm] = useState(false);
  const sttAutoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doSendRef = useRef<(() => void) | null>(null);
  const rKeyPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const callPlayKeyRef = useRef<string | null>(null);
  const callStripDoneRef = useRef<Set<string>>(new Set());

  // State for send button shaking
  const [sendButtonShake, setSendButtonShake] = useState(false);

  // Refs for dynamic vocal streaming chunking
  const callChunkQueueRef = useRef<string[]>([]);
  const callChunkPlayingRef = useRef<boolean>(false);
  const callChunkCurrentAudioRef = useRef<HTMLAudioElement | null>(null);
  const callChunkNextWordIndexRef = useRef<number>(0);
  const callChunkActiveMessageIdRef = useRef<string>('');
  const callChunkAbortedRef = useRef<boolean>(false);

  // ── MINI MODE: Full transparency fix for F10 floating window ──
  useEffect(() => {
    const html = document.documentElement;
    const root = document.getElementById('root');
    if (isMiniMode) {
      // Make everything transparent — CSS can't target html from body class
      html.style.background = 'transparent';
      html.style.backgroundColor = 'transparent';
      document.body.classList.add('mini-mode-active');
      document.body.style.background = 'transparent';
      document.body.style.backgroundColor = 'transparent';
      if (root) {
        root.style.visibility = 'hidden';
        root.style.pointerEvents = 'none';
        root.style.background = 'transparent';
        root.style.backgroundColor = 'transparent';
      }
    } else {
      html.style.background = '';
      html.style.backgroundColor = '';
      document.body.classList.remove('mini-mode-active');
      document.body.style.background = '';
      document.body.style.backgroundColor = '';
      if (root) {
        root.style.visibility = '';
        root.style.pointerEvents = '';
        root.style.background = '';
        root.style.backgroundColor = '';
      }
    }
    return () => {
      html.style.background = '';
      html.style.backgroundColor = '';
      document.body.classList.remove('mini-mode-active');
      document.body.style.background = '';
      document.body.style.backgroundColor = '';
      if (root) {
        root.style.visibility = '';
        root.style.pointerEvents = '';
        root.style.background = '';
        root.style.backgroundColor = '';
      }
    };
  }, [isMiniMode]);

  // ── MICROPHONE & OUTPUT VOLUME TRACKING SYSTEM ──
  useEffect(() => {
    let localStream: MediaStream | null = null;
    let localSource: MediaStreamAudioSourceNode | null = null;
    let localAnalyser: AnalyserNode | null = null;
    let localCtx: AudioContext | null = null;
    let micFrameId: number;

    if (callModeActive) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
          localStream = stream;
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            try {
            localCtx = new AudioContextClass();
            localAnalyser = localCtx.createAnalyser();
            localAnalyser.fftSize = 256;
            localSource = localCtx.createMediaStreamSource(stream);
            localSource.connect(localAnalyser);

            const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);
            
            const updateMicVolume = () => {
              if (!localAnalyser) return;
              localAnalyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const average = sum / dataArray.length;
              const micVolume = average / 128; // Normalize (0.0 to 1.5 approx)
              document.documentElement.style.setProperty('--mic-volume', micVolume.toString());
              
              if (callModeActive) {
                micFrameId = requestAnimationFrame(updateMicVolume);
              }
            };
            
            updateMicVolume();
            } catch (err) {
              console.warn('Mic analyser unavailable:', err);
            }
          }
        })
        .catch(err => {
          console.warn('Microphone access failed:', err);
        });
    }

    return () => {
      cancelAnimationFrame(micFrameId);
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (localCtx) {
        localCtx.close().catch(() => {});
      }
      document.documentElement.style.setProperty('--mic-volume', '0');
    };
  }, [callModeActive]);

  useEffect(() => {
    let animId: number;
    const dataArray = new Uint8Array(128);

    let smoothedVolume = 0;
    let lastCssUpdate = 0;

    const updateVolume = (now?: number) => {
      const t = now ?? performance.now();
      let volume = 0;
      const { analyser, context: audioCtx } = getSharedAnalyser();
      if (analyser && audioCtx && audioCtx.state === 'running') {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        volume = Math.min((average / 110) * 0.95, 0.75);
      }

      const currentMicVol = parseFloat(document.documentElement.style.getPropertyValue('--mic-volume') || '0');
      const maxVolume = Math.min(Math.max(volume, currentMicVol), 0.75);
      
      smoothedVolume = smoothedVolume * 0.9 + maxVolume * 0.1;
      
      const baseScale = 1 + Math.min(Math.max(smoothedVolume, 0.06), 0.55) * 0.35;
      if (t - lastCssUpdate > 130) {
        lastCssUpdate = t;
        document.documentElement.style.setProperty('--audio-scale', baseScale.toFixed(3));
      }

      animId = requestAnimationFrame(updateVolume);
    };

    updateVolume();
    return () => cancelAnimationFrame(animId);
  }, [callModeActive]);

  const handlePlaySelectionTTS = async () => {
    if (!selectionTTS) return;
    const text = selectionTTS.text;
    setSelectionTTS(null);
    window.getSelection()?.removeAllRanges();
    
    selectionStopRef.current = true;
    if (selectionAudioRef.current) {
      selectionAudioRef.current.pause();
    }
    (window as any).api?.stopTTS?.();

    const cleanText = text.replace(/[#*`_\[\]()]/g, '');
    const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+/g) || [cleanText];
    const voiceId = (window as any).currentVoiceId || 'F1';

    selectionStopRef.current = false;
    for (const sentence of sentences) {
      if (selectionStopRef.current) break;
      const result = await (window as any).api?.speakTTS(sentence.trim(), voiceId, 'auto');
      if (result?.base64Audio && !selectionStopRef.current) {
        const audio = new Audio(result.base64Audio);
        trackAudioElement(audio);
        selectionAudioRef.current = audio;
        await new Promise((res) => {
          audio.onended = res;
          audio.onerror = res;
          audio.play().catch(res);
        });
      }
    }
  };

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const messagesContainer = document.querySelector('.ai-messages');
          if (messagesContainer && messagesContainer.contains(range.commonAncestorContainer)) {
            setSelectionTTS({
              text: sel.toString(),
              top: rect.top - 44,
              left: rect.left + rect.width / 2 - 34
            });
            return;
          }
        }
        if ((e.target as HTMLElement).closest('.selection-tts-container')) return;
        setSelectionTTS(null);
      }, 10);
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      selectionStopRef.current = true;
      if (selectionAudioRef.current) selectionAudioRef.current.pause();
    };
  }, []);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width, height = img.height;
          const MAX_SIZE = 768; // Optimized for local vision models (speed + accuracy)
          if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } }
          else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
      };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const unsubStarting = (window as any).api?.onAiServerStarting?.(() => {
      if (!cancelled) {
        setIsConnecting(true);
        setBootHint('waiting');
      }
    });

    (window as any).api?.getSettings().then((s: any) => {
      if (cancelled) return;
      if (s?.aiModels) setAiModelsList(s.aiModels);
      if (s?.ttsVoice) setCurrentVoice(s.ttsVoice);
      if (s?.blurEnabled !== undefined) setBlurEnabled(s.blurEnabled);
      if (s?.wallEnabled !== undefined) setWallEnabled(s.wallEnabled);
      if (s?.currentWallpaper) setCurrentWallpaper(s.currentWallpaper);
    });

    (async () => {
      setIsConnecting(true);
      setBootHint('waiting');
      for (let i = 0; i < 120 && !cancelled; i++) {
        try {
          const ok = await (window as any).api?.pingAI?.();
          if (ok) {
            setIsRunning(true);
            setIsConnecting(false);
            setBootHint('ready');
            return;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setIsConnecting(false);
        setBootHint('idle');
      }
    })();

    const check = async () => {
      if (isStarting) return;
      try {
        const isOk = await (window as any).api?.pingAI?.();
        if (!isStarting) {
          setIsRunning(!!isOk);
          if (isOk) {
            setIsConnecting(false);
            if (bootHint === 'waiting') setBootHint('ready');
          }
        }
      } catch {
        if (!isStarting && !isConnecting) setIsRunning(false);
      }
    };
    const t = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
      unsubStarting?.();
    };
  }, []);

  useEffect(() => {
    if (bootHint !== 'ready') return;
    const t = setTimeout(() => setBootHint('idle'), 8000);
    return () => clearTimeout(t);
  }, [bootHint]);

  useEffect(() => {
    if (messages.length === 0 && !callModeActive && textareaRef.current) {
      textareaRef.current.style.height = '24px';
    }
  }, [messages.length, currentSessionId, callModeActive]);

  // Unified textarea auto-resize when input changes programmatically (e.g., speech-to-text)
  useEffect(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const resizeTextarea = () => {
      if (!input) {
        textarea.style.height = '24px';
      } else {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
      }
    };
    resizeTextarea();
    const observer = new MutationObserver(resizeTextarea);
    observer.observe(textarea, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [input, callModeActive]);

  const inputPlaceholder = useMemo(() => {
    if (planMode) return 'Describe your project...';
    if (isConnecting || isStarting) return 'Please wait — starting the AI model...';
    if (bootHint === 'ready') return 'XAi — Now you can ask anything';
    if (!isRunning) return 'Message XAi... (model offline)';
    return 'Message XAi...';
  }, [planMode, isConnecting, isStarting, bootHint, isRunning]);

  const showEmptyCentered = (messages.length === 0 && !callModeActive) || emptyChatLaunching;

  useEffect(() => {
    const status: 'offline' | 'connecting' | 'online' =
      isRunning ? 'online' : ((isStarting || isConnecting) ? 'connecting' : 'offline');
    if (status !== lastConnectionState) {
      setLastConnectionState(status);
      setConnectionFlash(status);
      const t = setTimeout(() => setConnectionFlash(''), 3000);
      return () => clearTimeout(t);
    }
  }, [isRunning, isStarting, isConnecting, lastConnectionState]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowModelDropdown(false);
    };
    if (showModelDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelDropdown]);

  useEffect(() => {
    const handleVoiceClickOutside = (e: MouseEvent) => {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node)) setShowVoiceDropdown(false);
    };
    if (showVoiceDropdown) document.addEventListener('mousedown', handleVoiceClickOutside);
    return () => document.removeEventListener('mousedown', handleVoiceClickOutside);
  }, [showVoiceDropdown]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (quickPromptRef.current && !quickPromptRef.current.contains(e.target as Node)) {
        setShowQuickPromptMenu(false);
      }
    };
    if (showQuickPromptMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQuickPromptMenu]);

  const handleSelectVoice = async (voiceId: string) => {
    setCurrentVoice(voiceId);
    setShowVoiceDropdown(false);
    try {
      const s = await (window as any).api?.getSettings();
      if (s) {
        s.ttsVoice = voiceId;
        await (window as any).api?.saveSettings(s);
      }
    } catch (e) {
      console.error('Failed to save quick voice switcher change:', e);
    }
  };

  const handleRenameSession = () => {
    if (!selectedSessionId) return;
    const newTitle = prompt('Enter new chat title:');
    if (newTitle && newTitle.trim()) {
      renameSession(selectedSessionId, newTitle.trim());
    }
    setContextMenuOpen(false);
  };

  const handleExportChat = async (format: 'txt' | 'pdf' | 'png') => {
    if (!selectedSessionId) return;
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session) return;

    let content = '';
    session.messages.forEach(msg => {
      content += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
    });

    if (format === 'txt') {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'pdf') {
      // For PDF, we'll use a simple text export for now
      // In a real implementation, you'd use a library like jsPDF
      alert('PDF export requires additional library. Exporting as TXT instead.');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === 'png') {
      // For PNG, we'll use html2canvas
      alert('PNG export requires additional library. Exporting as TXT instead.');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session.title}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }

    setContextMenuOpen(false);
  };

  const handleDeleteSession = () => {
    if (!selectedSessionId) return;
    deleteSession(selectedSessionId);
    if (selectedSessionId === currentSessionId) {
      if (sessions.length > 1) {
        const remaining = sessions.filter(s => s.id !== selectedSessionId);
        setCurrentSessionId(remaining[0].id);
      } else {
        createNewSession();
      }
    }
    setContextMenuOpen(false);
  };

  // RAF scroll — no layout thrashing
  useEffect(() => {
    if (!autoScroll || !isStreaming) return;
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => scrollToBottom(false));
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, [messages, autoScroll, isStreaming, scrollToBottom]);

  // Auto Vocal: automatically generate voice for the last response when streaming finishes
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.content && !lastMsg.audioUrl) {
        const lastIdx = messages.length - 1;
        (async () => {
          try {
            const settings = await (window as any).api?.getSettings();
            if (!callModeActive && !settings?.autoVocal) return;

            // Show "Processing Voice Message..." indicator
            setSessions(prev => prev.map(s => {
              if (s.id === currentSessionId) {
                const arr = [...s.messages];
                if (arr[lastIdx]?.role === 'assistant') {
                  arr[lastIdx] = { ...arr[lastIdx], audioUrl: 'loading' };
                }
                return { ...s, messages: arr };
              }
              return s;
            }));

            const voice = settings?.ttsVoice || 'F1';
            const cleanText = lastMsg.content.replace(/[#*`_\[\]()]/g, '');
            if (!cleanText.trim()) return;
            const result = await (window as any).api?.speakTTS(cleanText.trim(), voice, 'auto');
            if (result?.base64Audio) {
              setSessions(prev => prev.map(s => {
                if (s.id === currentSessionId) {
                  const arr = [...s.messages];
                  if (arr[lastIdx]?.role === 'assistant') {
                    arr[lastIdx] = { ...arr[lastIdx], audioUrl: 'autoplay:' + result.base64Audio };
                  }
                  return { ...s, messages: arr };
                }
                return s;
              }));
            } else {
              setSessions(prev => prev.map(s => {
                if (s.id === currentSessionId) {
                  const arr = [...s.messages];
                  if (arr[lastIdx]?.role === 'assistant' && arr[lastIdx].audioUrl === 'loading') {
                    arr[lastIdx] = { ...arr[lastIdx], audioUrl: undefined };
                  }
                  return { ...s, messages: arr };
                }
                return s;
              }));
            }
          } catch (e) {
            console.error('Auto vocal error:', e);
            setSessions(prev => prev.map(s => {
              if (s.id === currentSessionId) {
                const arr = [...s.messages];
                if (arr[lastIdx]?.role === 'assistant' && arr[lastIdx].audioUrl === 'loading') {
                  arr[lastIdx] = { ...arr[lastIdx], audioUrl: undefined };
                }
                return { ...s, messages: arr };
              }
              return s;
            }));
          }
        })();
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, messages, currentSessionId, setSessions, callModeActive]);

  const lastCallAudio = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    return { id: last.id, audioUrl: last.audioUrl ?? null };
  }, [messages]);

  // Call mode: play assistant vocal (messages hidden — do not pause on autoplay: strip)
  useEffect(() => {
    if (!callModeActive) {
      callAudioRef.current?.pause();
      callAudioRef.current = null;
      callPlayKeyRef.current = null;
      callStripDoneRef.current.clear();
      return;
    }

    if (isStreaming || !lastCallAudio?.audioUrl || lastCallAudio.audioUrl === 'loading') return;

    // If this message was already spoken via dynamic chunks, bypass full autoplay
    if (lastCallAudio.id === callChunkActiveMessageIdRef.current) {
      if (lastCallAudio.audioUrl.startsWith('autoplay:')) {
        const cleanSrc = lastCallAudio.audioUrl.slice(9);
        setSessions(prev => prev.map(s => {
          if (s.id !== currentSessionId) return s;
          return {
            ...s,
            messages: s.messages.map(m =>
              m.id === lastCallAudio.id && m.audioUrl?.startsWith('autoplay:')
                ? { ...m, audioUrl: cleanSrc }
                : m
            ),
          };
        }));
      }
      return;
    }

    const src = lastCallAudio.audioUrl.startsWith('autoplay:')
      ? lastCallAudio.audioUrl.slice(9)
      : lastCallAudio.audioUrl;
    const playKey = `${lastCallAudio.id}:${src.length}`;
    if (callPlayKeyRef.current === playKey) return;

    callAudioRef.current?.pause();
    callPlayKeyRef.current = playKey;

    const audio = new Audio(src);
    callAudioRef.current = audio;
    try {
      trackAudioElement(audio);
    } catch {
      /* play without analyser if WebAudio fails */
    }

    const onDone = () => {
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    };

    audio.onended = onDone;
    audio.onerror = () => {
      callPlayKeyRef.current = null;
      onDone();
    };

    const startPlay = () => {
      audio.play()
        .then(() => {
          window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: true } }));
          if (
            lastCallAudio.audioUrl?.startsWith('autoplay:') &&
            !callStripDoneRef.current.has(lastCallAudio.id)
          ) {
            callStripDoneRef.current.add(lastCallAudio.id);
            setSessions(prev => prev.map(s => {
              if (s.id !== currentSessionId) return s;
              return {
                ...s,
                messages: s.messages.map(m =>
                  m.id === lastCallAudio.id && m.audioUrl?.startsWith('autoplay:')
                    ? { ...m, audioUrl: src }
                    : m
                ),
              };
            }));
          }
        })
        .catch((err) => {
          console.warn('Call mode autoplay failed:', err);
          callPlayKeyRef.current = null;
        });
    };

    if (audio.readyState >= 2) startPlay();
    else audio.addEventListener('canplay', startPlay, { once: true });
  }, [callModeActive, lastCallAudio, isStreaming, currentSessionId, setSessions]);

  // --- DYNAMIC VOCAL CHUNKING IN CALL ACTIVE MODE ---
  const playNextCallChunk = useCallback(async () => {
    if (callChunkAbortedRef.current) return;
    if (callChunkPlayingRef.current) return;
    if (callChunkQueueRef.current.length === 0) return;

    callChunkPlayingRef.current = true;
    const nextAudioBase64 = callChunkQueueRef.current.shift();
    if (!nextAudioBase64) {
      callChunkPlayingRef.current = false;
      return;
    }

    const audio = new Audio(nextAudioBase64);
    callChunkCurrentAudioRef.current = audio;
    
    try {
      trackAudioElement(audio);
    } catch (e) {
      console.warn('trackAudioElement error:', e);
    }

    audio.onended = () => {
      callChunkPlayingRef.current = false;
      callChunkCurrentAudioRef.current = null;
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
      playNextCallChunk();
    };

    audio.onerror = () => {
      callChunkPlayingRef.current = false;
      callChunkCurrentAudioRef.current = null;
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
      playNextCallChunk();
    };

    try {
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: true } }));
      await audio.play();
    } catch (err) {
      console.warn('Failed to play vocal chunk:', err);
      callChunkPlayingRef.current = false;
      callChunkCurrentAudioRef.current = null;
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
      playNextCallChunk();
    }
  }, []);

  useEffect(() => {
    if (!callModeActive) {
      callChunkAbortedRef.current = true;
      if (callChunkCurrentAudioRef.current) {
        callChunkCurrentAudioRef.current.pause();
        callChunkCurrentAudioRef.current = null;
      }
      callChunkQueueRef.current = [];
      callChunkPlayingRef.current = false;
      callChunkActiveMessageIdRef.current = '';
      callChunkNextWordIndexRef.current = 0;
      return;
    }

    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMsg || lastMsg.role !== 'assistant') return;

    if (isStreaming && lastMsg.id !== callChunkActiveMessageIdRef.current) {
      callChunkAbortedRef.current = false;
      if (callChunkCurrentAudioRef.current) {
        callChunkCurrentAudioRef.current.pause();
        callChunkCurrentAudioRef.current = null;
      }
      callChunkQueueRef.current = [];
      callChunkPlayingRef.current = false;
      callChunkActiveMessageIdRef.current = lastMsg.id;
      callChunkNextWordIndexRef.current = 0;
    }

    if (lastMsg.id === callChunkActiveMessageIdRef.current && !callChunkAbortedRef.current) {
      const cleanText = lastMsg.content.replace(/[#*`_\[\]()]/g, '');
      const words = cleanText.trim().split(/\s+/).filter(Boolean);

      const checkAndGenChunk = async () => {
        const voice = currentVoice || 'F1';
        
        if (isStreaming) {
          const isFirstChunk = callChunkNextWordIndexRef.current === 0;
          const minSplit = isFirstChunk ? 8 : 10;
          const maxSplit = isFirstChunk ? 14 : 18;
          let availableWordsCount = words.length - callChunkNextWordIndexRef.current;
          
          if (availableWordsCount >= minSplit) {
            let splitCount = -1;
            const searchEnd = Math.min(availableWordsCount, maxSplit);
            for (let i = minSplit - 1; i < searchEnd; i++) {
              const w = words[callChunkNextWordIndexRef.current + i];
              if (w && /[.!?،,;:]$/.test(w)) {
                splitCount = i + 1;
                break;
              }
            }
            if (splitCount === -1) {
              if (availableWordsCount >= maxSplit) {
                splitCount = maxSplit;
              } else {
                return;
              }
            }
            
            const chunkWords = words.slice(callChunkNextWordIndexRef.current, callChunkNextWordIndexRef.current + splitCount);
            callChunkNextWordIndexRef.current += splitCount;
            const chunkText = chunkWords.join(' ').trim();
            
            if (chunkText) {
              const res = await (window as any).api?.speakTTS(chunkText, voice, 'auto');
              if (res?.base64Audio && !callChunkAbortedRef.current) {
                callChunkQueueRef.current.push(res.base64Audio);
                setIsCallSpeaking(true);
                playNextCallChunk();
              }
            }
          }
        } else if (!isStreaming && words.length > callChunkNextWordIndexRef.current) {
          const chunkWords = words.slice(callChunkNextWordIndexRef.current);
          callChunkNextWordIndexRef.current = words.length;
          const chunkText = chunkWords.join(' ').trim();
          
          if (chunkText) {
            const res = await (window as any).api?.speakTTS(chunkText, voice, 'auto');
            if (res?.base64Audio && !callChunkAbortedRef.current) {
              callChunkQueueRef.current.push(res.base64Audio);
              setIsCallSpeaking(true);
              playNextCallChunk();
            }
          }
        }
      };

      checkAndGenChunk();
    }
  }, [messages, isStreaming, callModeActive, currentVoice, playNextCallChunk]);

  useEffect(() => {
    return () => {
      callChunkAbortedRef.current = true;
      if (callChunkCurrentAudioRef.current) {
        callChunkCurrentAudioRef.current.pause();
        callChunkCurrentAudioRef.current = null;
      }
      callChunkQueueRef.current = [];
      callChunkPlayingRef.current = false;
    };
  }, []);

  const handleStopWithVoice = useCallback(() => {
    stopGeneration();
    callChunkAbortedRef.current = true;
    if (callChunkCurrentAudioRef.current) {
      callChunkCurrentAudioRef.current.pause();
      callChunkCurrentAudioRef.current = null;
    }
    callChunkQueueRef.current = [];
    callChunkPlayingRef.current = false;
    window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    
    selectionStopRef.current = true;
    if (selectionAudioRef.current) {
      selectionAudioRef.current.pause();
      selectionAudioRef.current = null;
    }
    
    callAudioRef.current?.pause();
    callAudioRef.current = null;
    callPlayKeyRef.current = null;
    
    (window as any).api?.stopTTS?.();
    setIsCallSpeaking(false);
  }, [stopGeneration]);

  // Sound disabled

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // If we are very close to the bottom (within 15px), we consider it "at bottom"
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 15;
    if (!isAtBottom) {
      // User scrolled up, disable auto-scroll
      if (autoScroll) setAutoScroll(false);
    } else {
      // User scrolled to bottom, enable auto-scroll
      if (!autoScroll) setAutoScroll(true);
    }
  }, [autoScroll]);

  // Resize window for mini mode & Click-through handling
  useEffect(() => {
    if (!isMiniMode) {
      (window as any).api?.setIgnoreMouseEvents?.(false);
      return;
    }

    const h = miniExpanded ? 480 : 52;
    (window as any).api?.resizeWindow?.(700, h);

    // Click-through logic: ignore mouse if not over the container
    const handleMouseMove = (e: MouseEvent) => {
      const container = document.querySelector('.ai-mini-container');
      if (container) {
        const rect = container.getBoundingClientRect();
        const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom;
        (window as any).api?.setIgnoreMouseEvents?.(!isOver, { forward: true });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [miniExpanded, isMiniMode]);

  const syncInputCursor = (el: HTMLTextAreaElement) => {
    setInputCursor(el.selectionStart ?? el.value.length);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setHistoryCursor(-1);
    syncInputCursor(e.target);
    const trimmed = val.trimStart().toLowerCase();
    setPlanMode(trimmed.startsWith('/plan') || trimmed.startsWith('/diagram') || trimmed.startsWith('/thinking') || trimmed.startsWith('/help') || trimmed.startsWith('/scal'));
    const shouldShowCommands = val.trimStart().startsWith('/');
    setCommandMenuOpen(shouldShowCommands);
    if (!shouldShowCommands) setCommandIndex(0);
    setWordAutocompleteIndex(0);
    e.target.style.height = 'auto';
    const maxH = 200;
    e.target.style.height = Math.min(e.target.scrollHeight, maxH) + 'px';
  };

  const matchingCommands = COMMANDS.filter(c => {
    const token = input.trimStart().split(/\s+/)[0].toLowerCase();
    if (!token.startsWith('/')) return false;
    return c.cmd.startsWith(token);
  });

  const userInputHistory = useMemo(
    () =>
      messages
        .filter((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0)
        .map((m: any) => m.content),
    [messages]
  );

  const recentPhrases = useMemo(() => userInputHistory.slice(-12), [userInputHistory]);

  useEffect(() => {
    if (commandMenuOpen || isStreaming) {
      setWordSuggestions(prev => (prev.length ? [] : prev));
      return;
    }
    const { word } = getWordAtCursor(input, inputCursor);
    if (!word || (word.length < 2 && !word.startsWith('/'))) {
      setWordSuggestions(prev => (prev.length ? [] : prev));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const items = await searchAutocomplete(word, COMMANDS, recentPhrases, 4);
      if (cancelled) return;
      setWordSuggestions((prev) => {
        if (prev.length === items.length && prev.every((p, i) => p.value === items[i]?.value)) return prev;
        return items;
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, inputCursor, commandMenuOpen, isStreaming, recentPhrases]);

  const showWordAutocomplete = wordSuggestions.length > 0 && !isStreaming && !commandMenuOpen;
  const autocompleteCount = Math.min(4, wordSuggestions.length);

  const modelLinkState: 'offline' | 'connecting' | 'online' =
    isRunning ? 'online' : (isStarting || isConnecting ? 'connecting' : 'offline');

  const lastAssistantMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const callOrbShowBubbles =
    callModeActive &&
    !isAudioPlaying &&
    (isStreaming || (lastAssistantMsg?.role === 'assistant' && lastAssistantMsg.audioUrl === 'loading'));

  const applyWordSuggestion = (value: string) => {
    const { start, end } = getWordAtCursor(input, inputCursor);
    const before = input.slice(0, start);
    const after = input.slice(end);
    const spacer = value.startsWith('/') ? ' ' : (after.startsWith(' ') || !after ? ' ' : '');
    const next = before + value + spacer + after.replace(/^\s/, '');
    setInput(next);
    setWordAutocompleteIndex(0);
    setCommandMenuOpen(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = (before + value + spacer).length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
        setInputCursor(pos);
      }
    });
  };

  const applyCommand = (cmd: string) => {
    setInput(`${cmd} `);
    setCommandMenuOpen(false);
    setCommandIndex(0);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<any>) => {
    if (callModeActive) {
      if (e.key === 'Escape' && (isAudioPlaying || isCallSpeaking || isStreaming)) {
        e.preventDefault();
        handleStopWithVoice();
        return;
      }
    }
    if (showWordAutocomplete && wordSuggestions.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        applyWordSuggestion(wordSuggestions[wordAutocompleteIndex]?.value || wordSuggestions[0].value);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setWordAutocompleteIndex(prev => (prev + 1) % autocompleteCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setWordAutocompleteIndex(prev => (prev - 1 + autocompleteCount) % autocompleteCount);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setWordAutocompleteIndex(0);
        return;
      }
    }
    if (commandMenuOpen && matchingCommands.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        applyCommand(matchingCommands[commandIndex]?.cmd || matchingCommands[0].cmd);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIndex(prev => (prev + 1) % matchingCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIndex(prev => (prev - 1 + matchingCommands.length) % matchingCommands.length);
        return;
      }
    }
    if (!commandMenuOpen && !isStreaming && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && userInputHistory.length > 0) {
      const target = e.currentTarget;
      const hasSelection = target.selectionStart !== target.selectionEnd;
      if (hasSelection) return;

      if (e.key === 'ArrowUp' && target.selectionStart === 0) {
        e.preventDefault();
        if (historyCursor === -1) {
          draftBeforeHistoryRef.current = input;
          const idx = userInputHistory.length - 1;
          setHistoryCursor(idx);
          setInput(userInputHistory[idx]);
        } else {
          const idx = Math.max(0, historyCursor - 1);
          setHistoryCursor(idx);
          setInput(userInputHistory[idx]);
        }
        return;
      }

      if (e.key === 'ArrowDown' && target.selectionStart === target.value.length) {
        e.preventDefault();
        if (historyCursor === -1) return;
        const idx = historyCursor + 1;
        if (idx >= userInputHistory.length) {
          setHistoryCursor(-1);
          setInput(draftBeforeHistoryRef.current || '');
        } else {
          setHistoryCursor(idx);
          setInput(userInputHistory[idx]);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !showWordAutocomplete) {
      e.preventDefault();
      if (messages.length === 0 && !callModeActive) handleEmptyOrSend();
      else doSend();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const compressed = await compressImage(file); setSelectedImage(compressed); }
    e.target.value = '';
  };

  const waitForReady = async (maxRetries = 60) => {
    for (let i = 0; i < maxRetries; i++) {
      try { const isOk = await (window as any).api?.pingAI?.(); if (isOk) return true; } catch { }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  };

  const doSend = useCallback(async () => {
    if (!input.trim() && !selectedImage) {
      setSendButtonShake(true);
      setTimeout(() => setSendButtonShake(false), 800);
      return;
    }
    if (input.trim() === '/model') {
      const path = await (window as any).api?.pickModelFile();
      if (path) { setIsStarting(true); const res = await (window as any).api?.startAI(path); if (res?.success) { if (await waitForReady()) setIsRunning(true); (window as any).api?.getSettings().then((s:any) => setAiModelsList(s?.aiModels||[])); } setIsStarting(false); }
      setInput(''); return;
    }
    if (input.trim() === '/model_vision') {
      const modelPath = await (window as any).api?.pickModelFile();
      if (modelPath) { const mmprojPath = await (window as any).api?.pickMmprojFile(); if (mmprojPath) { setIsStarting(true); const res = await (window as any).api?.startAI(modelPath, mmprojPath); if (res?.success) { if (await waitForReady()) setIsRunning(true); (window as any).api?.getSettings().then((s:any) => setAiModelsList(s?.aiModels||[])); } setIsStarting(false); } }
      setInput(''); return;
    }
    if (input.trim().toLowerCase() === '/settings') { navigate('/settings'); setInput(''); return; }
    if (input.trim().toLowerCase() === '/clear') { clearChat(); setInput(''); return; }

    if (input.trim().toLowerCase() === '/sound') {
      const next = !soundsEnabled;
      setSoundsEnabled(next);
      const msg = { id: Date.now().toString(), role: 'system' as const, content: `Sounds: ${next ? 'ENABLED' : 'MUTED'}` };
      setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
      setInput(''); return;
    }

    if (input.trim().toLowerCase() === '/intro') {
      (window as any).api?.getSettings().then((s: any) => {
        if (s) {
          s.introEnabled = !s.introEnabled;
          (window as any).api?.saveSettings(s);
          const msg = { id: Date.now().toString(), role: 'system' as const, content: `Intro Animation: ${s.introEnabled ? 'ENABLED' : 'DISABLED'}` };
          setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
        }
      });
      setInput(''); return;
    }

    if (input.trim().toLowerCase().startsWith('/scal')) {
      const parts = input.trim().split(' ');
      if (parts.length >= 2) {
        const val = parseInt(parts[1]);
        if (!isNaN(val) && val >= 10 && val <= 200) {
          setZoom(val);
          const msg = { id: Date.now().toString(), role: 'system' as const, content: `UI Scale set to: ${val}%` };
          setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
        }
      }
      setInput(''); return;
    }

    if (input.trim().toLowerCase() === '/help') {
      const helpMsg = `###  XAi Commands
- \`/settings\` — Open application configuration.
- \`/plan\` — Activate project scaffolding mode.
- \`/diagram\` — Generate technical diagrams & charts.
- \`/clear\` — Wipe current chat history.
- \`/model\` — Quickly switch or load a local model file.
- \`/sound\` — Toggle sound effects on/off.
- \`/intro\` — Toggle intro animation on/off.
- \`/scale 10-200\` — Adjust UI scale (50 is normal).
- \`/white\` — Use soft white theme.
- \`/blur\` — Toggle luxury blur background.
- \`/wall\` — Toggle wallpaper background.`;
      const userMsg = { id: Date.now().toString() + '-u', role: 'user', content: '/help' };
      const assistantMsg = { id: (Date.now() + 1).toString() + '-a', role: 'assistant', content: helpMsg };
      setSessions((prev: any) => prev.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, userMsg, assistantMsg], timestamp: Date.now() } : s)));
      setInput(''); return;
    }

    if (input.trim().toLowerCase() === '/white' || input.trim().toLowerCase() === '/dark') {
      const targetTheme = input.trim().toLowerCase() === '/white' ? 'soft-white' : 'dark';
      (window as any).api?.getSettings().then((s: any) => {
        if (s) {
          s.theme = targetTheme;
          (window as any).api?.saveSettings(s);
          document.documentElement.setAttribute('data-theme', targetTheme);
          const msg = {
            id: Date.now().toString(),
            role: 'system' as const,
            content: `Theme switched to: ${targetTheme === 'soft-white' ? 'White' : 'Dark'}`
          };
          setSessions((prevS: any) => prevS.map((sess: any) => (sess.id === currentSessionId ? { ...sess, messages: [...sess.messages, msg] } : sess)));
        }
      });
      setInput('');
      return;
    }

    if (input.trim().toLowerCase() === '/blur') {
      const next = !blurEnabled;
      setBlurEnabled(next);
      if (next) setWallEnabled(false); // blur and wall are exclusive
      const msg = { id: Date.now().toString(), role: 'system' as const, content: `Blur Background: ${next ? 'ON' : 'OFF'}` };
      setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
      (window as any).api?.getSettings().then((s: any) => {
        if (s) {
          s.blurEnabled = next;
          if (next) s.wallEnabled = false;
          (window as any).api?.saveSettings(s);
        }
      });
      setInput(''); return;
    }

    if (input.trim().toLowerCase() === '/wall') {
      if (!wallEnabled) {
        setWallEnabled(true);
        setBlurEnabled(false);
        const msg = { id: Date.now().toString(), role: 'system' as const, content: `Wallpaper Background: ON` };
        setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
        (window as any).api?.getSettings().then((s: any) => {
          if (s) {
            s.wallEnabled = true;
            s.blurEnabled = false;
            (window as any).api?.saveSettings(s);
          }
        });
      } else {
        (async () => {
          try {
            const list = await (window as any).api?.getWallpapers();
            if (list && list.length > 0) {
              const currentIndex = list.indexOf(currentWallpaper);
              const nextIndex = (currentIndex + 1) % list.length;
              const nextWallpaper = list[nextIndex];
              
              setCurrentWallpaper(nextWallpaper);
              const msg = { id: Date.now().toString(), role: 'system' as const, content: `Wallpaper Background: Switched to ${nextWallpaper}` };
              setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
              
              const s = await (window as any).api?.getSettings();
              if (s) {
                s.currentWallpaper = nextWallpaper;
                await (window as any).api?.saveSettings(s);
              }
            } else {
              const msg = { id: Date.now().toString(), role: 'system' as const, content: `Wallpaper Background: No other wallpapers found` };
              setSessions((prevS: any) => prevS.map((s: any) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, msg] } : s)));
            }
          } catch (e) {
            console.error('Wallpaper cycle failed:', e);
          }
        })();
      }
      setInput(''); return;
    }

    if (!isRunning) return;

    let outgoing = input.trim();
    if (outgoing) {
      outgoing = wrapWithQuickPrompt(outgoing, quickPromptId);
    } else if (selectedImage && quickPromptId !== 'none') {
      const preset = QUICK_PROMPTS.find((p) => p.id === quickPromptId);
      outgoing = preset?.instruction || '';
    }
    if (outgoing || selectedImage) sendMessage(outgoing, selectedImage);
    setCommandMenuOpen(false);
    setTimeout(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.focus(); } setPlanMode(false); }, 50);
  }, [sendMessage, input, setInput, soundsEnabled, blurEnabled, wallEnabled, currentSessionId, setSessions, setSoundsEnabled, navigate, clearChat, createNewSession, isRunning, setZoom, quickPromptId, selectedImage]);

  // Update doSendRef whenever doSend changes
  useEffect(() => {
    doSendRef.current = doSend;
  }, [doSend]);

  const handleEmptyOrSend = useCallback(() => {
    if (messages.length > 0 || callModeActive) {
      doSend();
      return;
    }
    if (emptyChatLaunching || isStreaming) return;
    
    if (!input.trim() && !selectedImage) {
      setSendButtonShake(true);
      setTimeout(() => setSendButtonShake(false), 800);
      return;
    }

    setEmptyChatLaunching(true);
    window.setTimeout(() => {
      doSend();
      window.setTimeout(() => setEmptyChatLaunching(false), 280);
    }, 420);
  }, [messages.length, callModeActive, emptyChatLaunching, isStreaming, input, selectedImage, doSend]);

  const regenerateAtIndex = useCallback((assistantIndex: number) => {
    if (isStreaming || assistantIndex < 0) return;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        sendMessage(messages[i].content, messages[i].image || null);
        return;
      }
    }
  }, [messages, isStreaming, sendMessage]);

  const deleteMessageAtIndex = useCallback((index: number) => {
    if (isStreaming) return;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentSessionId) return s;
        const arr = [...s.messages];
        arr.splice(index, 1);
        return { ...s, messages: arr };
      })
    );
  }, [currentSessionId, isStreaming, setSessions]);

  // STT Recording Functions
  const startRecording = useCallback(async () => {
    try {
      console.log('Starting recording...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Got audio stream');
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log('Audio chunk received, size:', event.data.size);
        }
      };
      
      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing audio...');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        console.log('Audio blob created, size:', audioBlob.size);
        const audioPath = `${Date.now()}_recording.wav`;
        
        // Convert blob to base64 and save to temp file via electron API
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          console.log('Audio converted to base64, length:', base64Audio.length);
          try {
            // Save audio to temp file via electron API
            const saveResult = await (window as any).api?.saveAudioToTemp(base64Audio, audioPath);
            console.log('Save result:', saveResult);
            
            if (saveResult?.success && saveResult?.path) {
              console.log('Audio saved to:', saveResult.path);
              // Transcribe audio
              const result = await (window as any).api?.transcribeAudio(saveResult.path);
              console.log('Transcription result:', result);
              
              if (result?.success && result?.text) {
                console.log('Transcription successful:', result.text);
                setInput(result.text);
                
                // Only show confirmation and auto-send in call mode
                if (callModeActive) {
                  setShowSTTConfirm(true);
                  
                  // Auto-send after 4 seconds
                  sttAutoSendTimerRef.current = setTimeout(() => {
                    setShowSTTConfirm(false);
                    if (doSendRef.current) {
                      doSendRef.current();
                    }
                  }, 4000);
                }
              } else {
                console.error('Transcription failed or no text:', result);
              }
            } else {
              console.error('Failed to save audio:', saveResult);
            }
          } catch (e) {
            console.error('Transcription failed:', e);
          }
        };
        reader.readAsDataURL(audioBlob);
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      recordingStartTimeRef.current = Date.now();
      console.log('Recording started');
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
  }, [setInput, doSend]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }, [isRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleSTTConfirmSend = useCallback(() => {
    if (sttAutoSendTimerRef.current) {
      clearTimeout(sttAutoSendTimerRef.current);
      sttAutoSendTimerRef.current = null;
    }
    setShowSTTConfirm(false);
    if (doSendRef.current) {
      doSendRef.current();
    }
  }, []);

  const handleSTTEdit = useCallback(() => {
    if (sttAutoSendTimerRef.current) {
      clearTimeout(sttAutoSendTimerRef.current);
      sttAutoSendTimerRef.current = null;
    }
    setShowSTTConfirm(false);
    // Focus on textarea for editing
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 100);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        setIsMiniMode(prev => {
          const newState = !prev;
          (window as any).api?.setMiniMode?.(newState);
          return newState;
        });
        setMiniExpanded(false);
      }
      // Alt+T: Toggle between Call Active and Message Active
      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        setCallModeActive(prev => {
          if (!prev) getSharedAnalyser();
          return !prev;
        });
      }
      // Global Escape to stop speaking in call mode
      if (e.key === 'Escape' && callModeActive && (isAudioPlaying || isCallSpeaking || isStreaming)) {
        e.preventDefault();
        handleStopWithVoice();
      }
      // Long-press R for recording (2 seconds)
      if ((e.key === 'r' || e.key === 'R') && !e.repeat && !isRecording) {
        // Start timer for 2 seconds
        rKeyPressTimerRef.current = setTimeout(() => {
          if (!isRecording) {
            startRecording();
          }
        }, 2000);
      }
    };
    
    const handleGlobalKeyUp = (e: KeyboardEvent) => {
      // Release R to stop recording or cancel timer
      if ((e.key === 'r' || e.key === 'R')) {
        if (rKeyPressTimerRef.current) {
          clearTimeout(rKeyPressTimerRef.current);
          rKeyPressTimerRef.current = null;
        }
        if (isRecording) {
          e.preventDefault();
          stopRecording();
        }
      }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
      if (rKeyPressTimerRef.current) {
        clearTimeout(rKeyPressTimerRef.current);
      }
    };
  }, [callModeActive, isAudioPlaying, isCallSpeaking, isStreaming, handleStopWithVoice, isRecording, startRecording, stopRecording]);

  const handleImportChat = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed) || parsed.messages) {
          const _s: AISession = { id: 'imported-' + Date.now(), title: parsed.title || 'Imported Chat', messages: parsed.messages || parsed, timestamp: Date.now() };
          setSessions((prev: AISession[]) => [_s, ...prev]); setCurrentSessionId(_s.id);
          setCustomDialog({
            isOpen: true,
            title: 'Import Success',
            message: 'Imported chat loading into a new session...',
            type: 'alert',
            onConfirm: () => {
              createNewSession();
            }
          });
        }
      } catch (e) {
        setCustomDialog({
          isOpen: true,
          title: 'Import Error',
          message: 'Invalid chat file.',
          type: 'alert',
          onConfirm: () => {}
        });
      }
    };
    reader.readAsText(file); e.target.value = '';
  };

  // ── المحتوى المشترك للـ mini overlay ──
  const miniOverlayContent = (
    <div className={`ai-mini-overlay ${isStreaming ? 'generating' : ''}`}>
      <div className="ai-mini-container">
        <div className="ai-mini-input-row" style={{ WebkitAppRegion: 'drag' } as any}>
          <div className="ai-mini-drag-handle" />
          <input
            autoFocus
            className="ai-mini-input"
            style={{ WebkitAppRegion: 'no-drag' } as any}
            placeholder="Ask XAi..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); setMiniExpanded(true); }
              if (e.key === 'Escape') { setIsMiniMode(false); (window as any).api?.setMiniMode?.(false); }
            }}
          />
          {/* Send Button */}
          {!isStreaming && (input.trim()) && (
            <button
              className="ai-mini-send-btn"
              onClick={() => { doSend(); setMiniExpanded(true); }}
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <Send size={15} />
            </button>
          )}

          {/* Loader or Expand Button */}
          {(isStreaming || messages.some(m => m.role === 'assistant')) && (
            <button
              className={`ai-mini-expand-btn ${miniExpanded ? 'open' : ''} ${isStreaming ? 'is-streaming' : ''}`}
              onClick={() => setMiniExpanded(!miniExpanded)}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              title={miniExpanded ? "Collapse" : "Show Response"}
            >
              {isStreaming && !miniExpanded ? <Loader className="ai-spin" size={15} /> : <ChevronRight size={16} />}
            </button>
          )}
        </div>

        {miniExpanded && (() => {
          const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
          return lastAssistant ? (
            <div className="ai-mini-response-box" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <div className="ai-mini-response-content">
                <AIMessage role="assistant" content={lastAssistant.content} reasoning={lastAssistant.reasoning} isStreaming={isStreaming} />
              </div>
            </div>
          ) : null;
        })()}
      </div>
    </div>
  );

  return (
    <>
      {/* ── PORTAL: يُرسل الـ overlay لـ document.body مباشرة خارج #root ── */}
      {isMiniMode && createPortal(miniOverlayContent, document.body)}

      {/* History Sidebar */}
      {historySidebarOpen && (
        <div className="history-sidebar glass-frame">
          <div className="history-sidebar-header">
            <h3>Chat History</h3>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setHistorySidebarOpen(false);
              }} 
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="history-sidebar-content">
            {sessions.map(session => (
              <div 
                key={session.id} 
                className={`history-chat-item ${session.id === currentSessionId ? 'active' : ''}`}
                onClick={() => setCurrentSessionId(session.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelectedSessionId(session.id);
                  setContextMenuPosition({ x: e.clientX, y: e.clientY });
                  setContextMenuOpen(true);
                }}
              >
                <div className="history-chat-title">{session.title}</div>
                <div className="history-chat-time">
                  {new Date(session.timestamp).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
          <div className="history-sidebar-footer">
            <button 
              className="clear-all-btn"
              onClick={() => {
                sessions.forEach(session => deleteSession(session.id));
                createNewSession();
              }}
            >
              <Trash2 size={14} /> Clear All Chat
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenuOpen && (
        <div 
          className="context-menu glass-frame"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            zIndex: 1001
          }}
          onClick={() => setContextMenuOpen(false)}
        >
          <div className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleRenameSession(); }}>
            <Edit2 size={14} /> Rename
          </div>
          <div className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleExportChat('txt'); }}>
            <Download size={14} /> Export as TXT
          </div>
          <div className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleExportChat('pdf'); }}>
            <Download size={14} /> Export as PDF
          </div>
          <div className="context-menu-item" onClick={(e) => { e.stopPropagation(); handleExportChat('png'); }}>
            <Download size={14} /> Export as PNG
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item danger" onClick={(e) => { e.stopPropagation(); handleDeleteSession(); }}>
            <Trash2 size={14} /> Delete
          </div>
        </div>
      )}

      {selectionTTS && (
        <div
          className="selection-tts-container"
          style={{
            position: 'fixed',
            top: Math.max(10, selectionTTS.top) + 'px',
            left: selectionTTS.left + 'px',
            zIndex: 9999,
            display: 'flex',
            gap: '4px',
            background: 'rgba(26, 26, 26, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            padding: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <button
            className="selection-tts-btn"
            style={{ background: 'transparent', border: 'none', padding: '4px', boxShadow: 'none', borderRadius: '4px' }}
            onClick={handlePlaySelectionTTS}
            title="Read Aloud"
          >
            <Volume2 size={14} />
          </button>
          <div style={{ width: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 2px' }} />
          <button
            className="selection-tts-btn"
            style={{ background: 'transparent', border: 'none', padding: '4px', boxShadow: 'none', borderRadius: '4px' }}
            onClick={async () => {
              const text = selectionTTS.text;
              setSelectionTTS(null);
              window.getSelection()?.removeAllRanges();
              
              const tempId = Date.now().toString() + '-a-voice';
              setSessions(prev => prev.map(s => {
                if (s.id === currentSessionId) {
                  return { ...s, messages: [...s.messages, { id: tempId, role: 'assistant', content: '', audioUrl: 'loading' }] };
                }
                return s;
              }));

              try {
                const settings = await (window as any).api?.getSettings();
                const voice = settings?.ttsVoice || 'F1';
                const cleanText = text.replace(/[#*`_\[\]()]/g, '');
                const result = await (window as any).api?.speakTTS(cleanText.trim(), voice, 'auto');
                if (result?.base64Audio) {
                  setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                      return { ...s, messages: s.messages.map(m => m.id === tempId ? { ...m, audioUrl: result.base64Audio } : m) };
                    }
                    return s;
                  }));
                }
              } catch(e) {
                setSessions(prev => prev.map(s => {
                  if (s.id === currentSessionId) {
                    return { ...s, messages: s.messages.filter(m => m.id !== tempId) };
                  }
                  return s;
                }));
              }
            }}
            title="Generate Voice Message"
          >
            <Mic size={14} />
          </button>
        </div>
      )}

      {/* ── Main Wrapper ── */}
      <div
        className={`ai-panel-wrapper sidebar-closed ${blurEnabled ? 'has-blur-bg' : ''} ${wallEnabled ? 'has-wall-bg' : ''}`}
        style={isMiniMode ? { display: 'none' } : { position: 'relative', zIndex: 1 }}
      >
        <AppBackground
          blurEnabled={blurEnabled}
          wallEnabled={wallEnabled}
          wallpaper={currentWallpaper || 'wallpaper.png'}
        />
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleImportChat} />

        <div className={`ai-panel fade-in ${showEmptyCentered ? 'is-initial' : ''} ${emptyChatLaunching ? 'is-chat-launching' : ''}`} style={(blurEnabled || wallEnabled) ? { background: 'transparent' } : {}}>
          {error && <div className="ai-error-banner"><AlertCircle size={15} /><span>{error}</span></div>}

          {messages.length === 0 && !callModeActive && (
            <div className="ai-initial-stack">
              <div className="gpr">
                <div className="gpr-sub">Hello, I'm</div>
                <h1 className="title letters">
                  <span style={{ "--i": 1 } as any}>X</span>
                  <span style={{ "--i": 2 } as any}>A</span>
                  <span style={{ "--i": 3 } as any}>I</span>
                </h1>
              </div>
            </div>
          )}

          <div 
            className="ai-messages" 
            ref={scrollContainerRef} 
            onScroll={handleScroll}
            style={{ display: callModeActive ? 'none' : 'block' }}
          >
            {messages.length > 0 && (
              messages.map((m: any, i: number) => (
                <AIMessage
                  key={m.id || i} role={m.role} content={m.content} reasoning={m.reasoning}
                  image={m.image} stats={m.stats} audioUrl={m.audioUrl}
                  onImageClick={(img) => setLightboxImage(img)}
                  onEdit={() => { setInput(m.content); if (m.image) setSelectedImage(m.image); if (textareaRef.current) textareaRef.current.focus(); }}
                  onRegenerate={() => regenerateAtIndex(i)}
                  onDelete={() => deleteMessageAtIndex(i)}
                  onUpdateAudio={(url) => {
                    setSessions(prev => prev.map(s => {
                      if (s.id === currentSessionId) {
                        const arr = [...s.messages];
                        arr[i] = { ...arr[i], audioUrl: url };
                        return { ...s, messages: arr };
                      }
                      return s;
                    }));
                  }}
                  isStreaming={i === messages.length - 1 && m.role === 'assistant' && isStreaming}
                  deferAutoplay={callModeActive}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {callModeActive && (
            <div className="orb-view-container">
              {callOrbShowBubbles && (
                <div className="orb-bubble-system">
                  <div className="bubble bubble-1"></div>
                  <div className="bubble bubble-2"></div>
                  <div className="bubble bubble-3"></div>
                  <div className="bubble bubble-4"></div>
                  <div className="bubble bubble-5"></div>
                  <div className="bubble bubble-6"></div>
                  <div className="bubble bubble-7"></div>
                  <div className="bubble bubble-8"></div>
                  <div className="bubble bubble-9"></div>
                  <div className="bubble bubble-10"></div>
                  <div className="bubble bubble-11"></div>
                  <div className="bubble bubble-12"></div>
                </div>
              )}
              <div className={`orb-wrapper ${isAudioPlaying ? 'active-talking' : ''}`}>
                <div className="loader">
                  <svg width="100" height="100" viewBox="0 0 100 100">
                    <defs>
                      <mask id="clipping">
                        <polygon points="0,0 100,0 100,100 0,100" fill="black"></polygon>
                        <polygon points="25,25 75,25 50,75" fill="white"></polygon>
                        <polygon points="50,25 75,75 25,75" fill="white"></polygon>
                        <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                        <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                        <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                        <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                      </mask>
                    </defs>
                  </svg>
                  <div className="box"></div>
                </div>
              </div>
            </div>
          )}

          {!autoScroll && (
            <div style={{ position: 'absolute', bottom: '70px', right: '30px', zIndex: 100 }}>
              <button
                style={{
                  background: 'rgba(20, 20, 20, 0.65)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '50%',
                  width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)', cursor: 'pointer', transition: 'all 0.2s'
                }}
                onClick={() => {
                  scrollToBottom(true);
                  setAutoScroll(true);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.background = 'rgba(40, 40, 40, 0.85)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.background = 'rgba(20, 20, 20, 0.65)';
                }}
                title="Scroll to bottom"
              >
                <ArrowDown size={18} />
              </button>
            </div>
          )}

          <div className={`ai-input-bar ${planMode ? 'plan-mode' : ''}`}>
            {selectedImage && (
              <div className="ai-image-preview-container">
                <div className="ai-image-preview">
                  <img src={selectedImage} alt="Selected" />
                  <button className="ai-remove-image" onClick={() => setSelectedImage(null)}><X size={14} /></button>
                </div>
              </div>
            )}
            <div className={`ai-input-card is-empty model-link-${modelLinkState} ${connectionFlash ? `flash-${connectionFlash}` : ''}`}>
              <div className="ai-input-light-mask">
                <div className="ai-input-light-mask-shield" />
              </div>
              <div className="ai-input-row-top ai-textarea-wrap">
                {showWordAutocomplete && (
                  <InputAutocompleteMenu
                    items={wordSuggestions}
                    activeIndex={wordAutocompleteIndex}
                    onSelect={applyWordSuggestion}
                    onHoverIndex={setWordAutocompleteIndex}
                  />
                )}
                <TypewriterPlaceholder text={inputPlaceholder} active={!input.trim() && !planMode && messages.length === 0} />
                <textarea
                  ref={textareaRef}
                  className="ai-textarea"
                  placeholder=""
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onSelect={(e) => syncInputCursor(e.currentTarget)}
                  onClick={(e) => syncInputCursor(e.currentTarget)}
                  rows={1}
                  autoComplete="off"
                  style={{}}
                />
              </div>
              <div className="ai-input-row-bottom">
                <div className="ai-input-actions-left">
                  <input type="file" ref={imageInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
                  <button className="ai-input-action-btn" onClick={() => setHistorySidebarOpen(!historySidebarOpen)} title="History Chat"><ChevronLeft size={16} /></button>
                  <button className="ai-input-action-btn" onClick={() => navigate('/settings')} title="Settings"><Settings size={16} /></button>
                  <div className="liquid-container">
                    <input 
                      type="checkbox" 
                      id="swipe-btn" 
                      className="liquid-input" 
                      checked={callModeActive}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setCallModeActive(on);
                        if (on) getSharedAnalyser();
                      }} 
                    />
                    <label htmlFor="swipe-btn" className="liquid-button">
                      <div className="button-bg">
                        <div className="glass-layer"></div>
                        <div className="reflex-shine"></div>

                        <div className="liquid-waves">
                          <div className="wave wave-1"></div>
                          <div className="wave wave-2"></div>
                          <div className="wave wave-3"></div>
                        </div>

                        <div className="bubble-system">
                          <div className="bubble bubble-1"></div>
                          <div className="bubble bubble-2"></div>
                          <div className="bubble bubble-3"></div>
                          <div className="bubble bubble-4"></div>
                          <div className="bubble bubble-5"></div>
                          <div className="bubble bubble-6"></div>
                        </div>

                        <div className="text-content">
                          <p className="text-initial">
                            <span className="char" style={{ "--i": 0 } as any}>S</span>
                            <span className="char" style={{ "--i": 1 } as any}>w</span>
                            <span className="char" style={{ "--i": 2 } as any}>i</span>
                            <span className="char" style={{ "--i": 3 } as any}>p</span>
                            <span className="char" style={{ "--i": 4 } as any}>e</span>
                            <span className="char" style={{ "--i": 5 } as any}>&nbsp;</span>
                            <span className="char" style={{ "--i": 6 } as any}>t</span>
                            <span className="char" style={{ "--i": 7 } as any}>o</span>
                            <span className="char" style={{ "--i": 8 } as any}>&nbsp;</span>
                            <span className="char" style={{ "--i": 9 } as any}>C</span>
                            <span className="char" style={{ "--i": 10 } as any}>a</span>
                            <span className="char" style={{ "--i": 11 } as any}>l</span>
                            <span className="char" style={{ "--i": 12 } as any}>l</span>
                          </p>
                          <p className="text-confirmed">
                            <span className="char" style={{ "--i": 0 } as any}>C</span>
                            <span className="char" style={{ "--i": 1 } as any}>a</span>
                            <span className="char" style={{ "--i": 2 } as any}>l</span>
                            <span className="char" style={{ "--i": 3 } as any}>l</span>
                            <span className="char" style={{ "--i": 4 } as any}>&nbsp;</span>
                            <span className="char" style={{ "--i": 5 } as any}>A</span>
                            <span className="char" style={{ "--i": 6 } as any}>c</span>
                            <span className="char" style={{ "--i": 7 } as any}>t</span>
                            <span className="char" style={{ "--i": 8 } as any}>i</span>
                            <span className="char" style={{ "--i": 9 } as any}>v</span>
                            <span className="char" style={{ "--i": 10 } as any}>e</span>
                          </p>
                        </div>

                        <div className="swipe-handle">
                          <div className="handle-glow"></div>
                          {callModeActive ? (
                            <Phone size={14} style={{ color: '#ffffff' }} />
                          ) : (
                            <MessageSquare size={14} style={{ color: 'var(--primary-color)' }} />
                          )}
                        </div>

                        <div className="particle-burst">
                          <div className="particle particle-1"></div>
                          <div className="particle particle-2"></div>
                          <div className="particle particle-3"></div>
                          <div className="particle particle-4"></div>
                          <div className="particle particle-5"></div>
                          <div className="particle particle-6"></div>
                          <div className="particle particle-7"></div>
                          <div className="particle particle-8"></div>
                        </div>

                        <div className="ripple-effect">
                          <div className="ripple ripple-1"></div>
                          <div className="ripple ripple-2"></div>
                          <div className="ripple ripple-3"></div>
                        </div>
                      </div>
                    </label>
                  </div>
                  <div style={{ position: 'relative' }} ref={quickPromptRef}>
                    <button
                      type="button"
                      className={`ai-input-action-btn ai-quick-prompt-btn ${quickPromptId !== 'none' ? 'active-prompt' : ''} ${showQuickPromptMenu ? 'open' : ''}`}
                      onClick={() => setShowQuickPromptMenu((v) => !v)}
                      title="Quick prompt mode"
                      disabled={isStreaming}
                    >
                      <Wand2 size={16} />
                    </button>
                    {showQuickPromptMenu && (
                      <div className="ai-quick-prompt-dropdown">
                        <div className="ai-quick-prompt-header">Prompt mode</div>
                        {QUICK_PROMPTS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`ai-quick-prompt-item ${quickPromptId === p.id ? 'active' : ''}`}
                            onClick={() => {
                              setQuickPromptId(p.id);
                              setShowQuickPromptMenu(false);
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="ai-input-action-btn" onClick={() => imageInputRef.current?.click()} disabled={!isRunning} title="Upload image"><ImageIcon size={16} /></button>
                  <button className={`ai-input-action-btn ${thinkingMode === 'think' ? 'active-think' : ''}`} onClick={() => setThinkingMode(thinkingMode === 'think' ? 'none' : 'think')} title={thinkingMode === 'think' ? 'Thinking Mode: ON' : 'Thinking Mode: OFF'}><Zap size={16} /></button>
                  <button className="ai-input-action-btn" onClick={() => { clearChat(); createNewSession(); }} title="Clear Chat & Start New" disabled={isStreaming}><Trash2 size={16} /></button>
                  
                  {/* Model Quick Switcher */}
                  <div style={{ position: 'relative' }} ref={dropdownRef}>
                    <button className={`ai-input-action-btn ai-model-switch-btn ${showModelDropdown ? 'active-model' : ''}`} onClick={() => setShowModelDropdown(!showModelDropdown)} title="Switch Model" disabled={isStreaming}>
                      <Server size={16} />
                    </button>
                    {showModelDropdown && (
                      <div className="ai-model-dropdown">
                        <div className="ai-model-dropdown-header">Quick Switch Model</div>
                        {aiModelsList.length === 0 ? (
                          <div className="ai-model-dropdown-item" style={{ opacity: 0.5 }}>No models found</div>
                        ) : (
                          aiModelsList.map(m => (
                            <button key={m.id} className="ai-model-dropdown-item" onClick={async () => {
                              setShowModelDropdown(false);
                              setIsStarting(true);
                              const res = await (window as any).api?.startAI(m.modelPath, m.mmprojPath);
                              if (res?.success) { if (await waitForReady()) setIsRunning(true); (window as any).api?.getSettings().then((s:any) => setAiModelsList(s?.aiModels||[])); }
                              setIsStarting(false);
                            }}>
                              <Cpu size={14} /> {m.name}
                            </button>
                          ))
                        )}
                        <div className="ai-model-dropdown-header" style={{ marginTop: '4px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>Load Custom</div>
                        <button className="ai-model-dropdown-item" onClick={async () => {
                          setShowModelDropdown(false);
                          const path = await (window as any).api?.pickModelFile();
                          if (path) { setIsStarting(true); const res = await (window as any).api?.startAI(path); if (res?.success) { if (await waitForReady()) setIsRunning(true); (window as any).api?.getSettings().then((s:any) => setAiModelsList(s?.aiModels||[])); } setIsStarting(false); }
                        }}>
                          <Cpu size={14} /> Load Text Model (.gguf)
                        </button>
                        <button className="ai-model-dropdown-item" onClick={async () => {
                          setShowModelDropdown(false);
                          const modelPath = await (window as any).api?.pickModelFile();
                          if (modelPath) { const mmprojPath = await (window as any).api?.pickMmprojFile(); if (mmprojPath) { setIsStarting(true); const res = await (window as any).api?.startAI(modelPath, mmprojPath); if (res?.success) { if (await waitForReady()) setIsRunning(true); (window as any).api?.getSettings().then((s:any) => setAiModelsList(s?.aiModels||[])); } setIsStarting(false); } }
                        }}>
                          <ImageIcon size={14} /> Load Vision Model
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick Voice Switcher - Hidden */}
                  {/* <div style={{ position: 'relative' }} ref={voiceDropdownRef}>
                    <button className={`ai-input-action-btn ${showVoiceDropdown ? 'active-voice' : ''}`} onClick={() => setShowVoiceDropdown(!showVoiceDropdown)} title="Quick Voice Switcher">
                      <Volume2 size={16} />
                      <span className="voice-badge">{currentVoice}</span>
                    </button>
                    {showVoiceDropdown && (
                      <div className="ai-voice-dropdown">
                        <div className="ai-voice-dropdown-header">Vocal Style</div>
                        <div className="ai-voice-dropdown-list">
                          <div className="ai-voice-dropdown-section-label">Female</div>
                          {VOICES_FEMALE.map(v => (
                            <button key={v.id} className={`ai-voice-dropdown-item ${currentVoice === v.id ? 'active' : ''}`} onClick={() => handleSelectVoice(v.id)}>
                              <span className="voice-avatar">{v.icon}</span>
                              <div className="voice-details">
                                <span className="voice-name">{v.label}</span>
                                <span className="voice-id">{v.id}</span>
                              </div>
                              {currentVoice === v.id && <span className="voice-check">✓</span>}
                            </button>
                          ))}
                          <div className="ai-voice-dropdown-section-label">Male</div>
                          {VOICES_MALE.map(v => (
                            <button key={v.id} className={`ai-voice-dropdown-item ${currentVoice === v.id ? 'active' : ''}`} onClick={() => handleSelectVoice(v.id)}>
                              <span className="voice-avatar">{v.icon}</span>
                              <div className="voice-details">
                                <span className="voice-name">{v.label}</span>
                                <span className="voice-id">{v.id}</span>
                              </div>
                              {currentVoice === v.id && <span className="voice-check">✓</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div> */}

                  {/* Context Memory Toggle */}
                  <button 
                    className={`ai-context-btn ${contextMemoryEnabled ? 'enabled' : ''}`}
                    onClick={() => setContextMemoryEnabled(!contextMemoryEnabled)}
                    title={contextMemoryEnabled ? "Context Memory: ON" : "Context Memory: OFF"}
                  >
                    <Save size={14} />
                  </button>

                </div>
                <div className="ai-input-actions-right">
                  {/* Radial Voice Menu Button */}
                  <div style={{ position: 'relative' }} ref={radialVoiceMenuRef}>
                    <button 
                      className="ai-radial-voice-btn"
                      onMouseDown={(e) => {
                        if (e.button === 0) {
                          setShowRadialVoiceMenu(true);
                          setSelectedRadialVoice(null);
                        }
                      }}
                      title="Quick Voice Switcher (Long Press)"
                    >
                      <Volume2 size={16} />
                    </button>
                    {currentVoice && (
                      <div className="radial-voice-indicator">
                        {VOICES.find(v => v.id === currentVoice)?.label || currentVoice}
                      </div>
                    )}
                    {showRadialVoiceMenu && (
                      <div 
                        className="radial-voice-menu glass-frame"
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const centerX = rect.left + rect.width / 2;
                          const centerY = rect.top + rect.height / 2;
                          const dx = e.clientX - centerX;
                          const dy = e.clientY - centerY;
                          let angle = Math.atan2(dy, dx) * 180 / Math.PI;
                          angle = angle + 90;
                          if (angle < 0) angle += 360;
                          const index = Math.floor(angle / 36) % 10;
                          const voices = [...VOICES_FEMALE, ...VOICES_MALE];
                          if (voices[index]) {
                            setSelectedRadialVoice(voices[index].id);
                          }
                        }}
                        onMouseUp={() => {
                          setShowRadialVoiceMenu(false);
                          if (selectedRadialVoice) {
                            handleSelectVoice(selectedRadialVoice);
                          }
                        }}
                        onMouseLeave={() => {
                          setShowRadialVoiceMenu(false);
                        }}
                      >
                        <svg className="radial-voice-svg" viewBox="0 0 220 220">
                          {[...VOICES_FEMALE, ...VOICES_MALE].map((voice, i) => {
                            const startAngle = (i * 36) - 90;
                            const endAngle = ((i + 1) * 36) - 90;
                            const midAngle = startAngle + 18;
                            const startRad = (startAngle * Math.PI) / 180;
                            const endRad = (endAngle * Math.PI) / 180;
                            const midRad = (midAngle * Math.PI) / 180;
                            const radius = 110;
                            const center = 110;
                            const x1 = center + radius * Math.cos(startRad);
                            const y1 = center + radius * Math.sin(startRad);
                            const x2 = center + radius * Math.cos(endRad);
                            const y2 = center + radius * Math.sin(endRad);
                            const pathD = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
                            const contentRadius = 70;
                            const contentX = center + contentRadius * Math.cos(midRad);
                            const contentY = center + contentRadius * Math.sin(midRad);
                            const isSelected = selectedRadialVoice === voice.id;
                            return (
                              <g key={voice.id}>
                                <path
                                  d={pathD}
                                  className={`radial-slice ${isSelected ? 'hovered' : ''}`}
                                />
                                <foreignObject
                                  x={contentX - 25}
                                  y={contentY - 22}
                                  width={50}
                                  height={44}
                                  style={{ pointerEvents: 'none' }}
                                >
                                  <div className={`radial-voice-item ${isSelected ? 'hovered' : ''}`}>
                                    <img 
                                      src={voiceImageUrl(voice.id)} 
                                      alt={voice.label}
                                      className="radial-voice-avatar-img"
                                    />
                                    <span className="radial-voice-name">{voice.label}</span>
                                  </div>
                                </foreignObject>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    )}
                  </div>
                  {(callModeActive || true) && (
                    <button 
                      className={`ai-mic-btn ${isRecording ? 'recording' : ''}`} 
                      onClick={toggleRecording}
                      title={isRecording ? "Stop Recording" : "Start Recording"}
                    >
                      <div className="orb">
                        <div className="icons">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                            <g fill="none" className="mic">
                              <rect width="8" height="13" x="8" y="2" fill="currentColor" rx="4"></rect>
                              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11a7 7 0 1 0 14 0m-7 10v-2"></path>
                            </g>
                          </svg>
                        </div>
                        <div className="ball">
                          <div className="container-lines"></div>
                          <div className="container-rings"></div>
                        </div>
                      </div>
                      <svg style={{position: 'absolute', width: 0, height: 0, pointerEvents: 'none'}}>
                        <filter id="gooey">
                          <feGaussianBlur in="SourceGraphic" stdDeviation="6"></feGaussianBlur>
                          <feColorMatrix values="1 0 0 0 0
                                                 0 1 0 0 0 
                                                 0 0 1 0 0
                                                 0 0 0 20 -10"></feColorMatrix>
                        </filter>
                      </svg>
                    </button>
                  )}
                  {isStreaming || (callModeActive && (isAudioPlaying || isCallSpeaking)) ? (
                    <button className="ai-stop-btn" onClick={handleStopWithVoice} title="Stop"><Square size={16} fill="currentColor" /></button>
                  ) : showEmptyCentered ? (
                    <FlySendButton
                      onClick={handleEmptyOrSend}
                      exiting={emptyChatLaunching}
                      disabled={isStreaming}
                      shake={sendButtonShake}
                      title="Send (Enter)"
                    />
                  ) : (
                    <button className={`ai-send-btn ${!isRunning ? 'model-loading' : ''} ${sendButtonShake ? 'button-shake' : ''}`} onClick={doSend} disabled={isStreaming} title="Send (Enter)"><Send size={16} /></button>
                  )}
                </div>
              </div>
            </div>
            
            {showSTTConfirm && (
              <div className="ai-stt-confirm">
                <div className="ai-stt-confirm-content">
                  <div className="ai-stt-confirm-icon">
                    <Mic size={20} />
                  </div>
                  <div className="ai-stt-confirm-text">
                    <div className="ai-stt-confirm-title">هل تود تعديل النص؟</div>
                    <div className="ai-stt-confirm-subtitle">سيتم الإرسال تلقائياً بعد 4 ثواني</div>
                  </div>
                  <div className="ai-stt-confirm-actions">
                    <button className="ai-stt-confirm-btn edit" onClick={handleSTTEdit}>
                      <Edit2 size={14} />
                      <span>تعديل</span>
                    </button>
                    <button className="ai-stt-confirm-btn send" onClick={handleSTTConfirmSend}>
                      <Send size={14} />
                      <span>إرسال</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {commandMenuOpen && matchingCommands.length > 0 && !showWordAutocomplete && (
              <div className="ai-command-menu">
                {matchingCommands.slice(0, 8).map((c, idx) => (
                  <button
                    key={c.cmd}
                    className={`ai-command-item ${idx === commandIndex ? 'active' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); applyCommand(c.cmd); }}
                  >
                    <span className="cmd">{c.cmd}</span>
                    <span className="desc">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lightboxImage && (
            <div className="ai-lightbox" onClick={() => setLightboxImage(null)}>
              <div className="ai-lightbox-content">
                <img src={lightboxImage} alt="Fullscreen View" />
                <button className="ai-lightbox-close"><X size={24} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isMiniMode && createPortal(
        <div className={`ai-mini-portal ai-mini-overlay ${isStreaming ? 'generating' : ''}`}>
          <div className="ai-mini-container">
            <div className="ai-mini-input-row" onClick={() => !miniExpanded && setMiniExpanded(true)}>
              <div className="ai-mini-drag-handle" />
              <input
                className="ai-mini-input"
                placeholder={isConnecting ? 'Connecting...' : isRunning ? 'Ask Copilot...' : 'Offline'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                autoFocus
              />
              {isStreaming ? (
                <div className="ai-mini-loader"><Loader size={16} className="ai-spin" /></div>
              ) : (
                <button className="ai-mini-send-btn" onClick={doSend} disabled={!input.trim()}>
                  <Send size={14} />
                </button>
              )}
              <button
                className={`ai-mini-expand-btn ${miniExpanded ? 'open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setMiniExpanded(!miniExpanded); }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {miniExpanded && (
              <div className="ai-mini-response-box">
                {messages.length > 0 ? (
                  <AIMessage
                    role={messages[messages.length - 1].role}
                    content={messages[messages.length - 1].content}
                    isStreaming={isStreaming && messages[messages.length - 1].role === 'assistant'}
                    stats={messages[messages.length - 1].stats}
                    reasoning={messages[messages.length - 1].reasoning}
                    image={messages[messages.length - 1].image}
                  />
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
                    Type a message to start...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {customDialog?.isOpen && (
        <div className="custom-dialog-overlay" onClick={() => {
          if (customDialog.type === 'alert') {
            customDialog.onConfirm();
            setCustomDialog(null);
          }
        }}>
          <div className="custom-dialog-box" onClick={e => e.stopPropagation()}>
            <div className="custom-dialog-title">{customDialog.title}</div>
            <div className="custom-dialog-message">{customDialog.message}</div>
            <div className="custom-dialog-buttons">
              {customDialog.type === 'confirm' && (
                <button className="button" onClick={() => {
                  customDialog.onCancel?.();
                  setCustomDialog(null);
                }}>Cancel</button>
              )}
              <button className="button button-primary" onClick={() => {
                customDialog.onConfirm();
                setCustomDialog(null);
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const VoiceProcessingIndicator = () => {
  const [progress, setProgress] = useState(8);
  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => Math.min(92, p + 2));
    }, 150);
    return () => window.clearInterval(id);
  }, []);
  return (
    <AudioProcessingBar
      label="Voice"
      progress={progress}
      title="Processing voice message…"
    />
  );
};

const AIMessage = memo(function AIMessage({ role, content, reasoning, image, stats, audioUrl, onImageClick, onEdit, onRegenerate, onDelete, onUpdateAudio, isStreaming, deferAutoplay }: {
  role: string; content: string; reasoning?: string; image?: string; audioUrl?: string;
  stats?: { time: number; tokens: number };
  onImageClick?: (img: string) => void; onEdit?: () => void; onRegenerate?: () => void; onDelete?: () => void; onUpdateAudio?: (url: string) => void; isStreaming: boolean;
  deferAutoplay?: boolean;
}) {
  const { thinkingMode } = useAI();
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [copyDone, setCopyDone] = useState(false);
  const handleCopy = useCallback(() => navigator.clipboard.writeText(content), [content]);
  const onCopy = useCallback(async () => {
    await handleCopy();
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 1200);
  }, [handleCopy]);

  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [ttsProgress, setTtsProgress] = useState(0);
  const [showPlayMenu, setShowPlayMenu] = useState(false);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [genVoiceProgress, setGenVoiceProgress] = useState(15);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTtsRef = useRef<boolean>(false);

  useEffect(() => {
    if (ttsState === 'playing') return;
    if (!isGeneratingVoice && ttsState !== 'loading') return;
    const id = window.setInterval(() => {
      setGenVoiceProgress((p) => Math.min(90, p + 2));
    }, 150);
    return () => window.clearInterval(id);
  }, [ttsState, isGeneratingVoice]);

  useEffect(() => {
    return () => {
      stopTtsRef.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      (window as any).api?.stopTTS?.();
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: ttsState === 'playing' } }));
  }, [ttsState]);

  const handlePlayTTS = async () => {
    if (ttsState === 'playing' || ttsState === 'loading') {
      stopTtsRef.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
      await (window as any).api?.stopTTS?.();
      setTtsState('idle');
      setTtsProgress(0);
      return;
    }
    
    setShowPlayMenu(false);
    try {
      setTtsState('loading');
      setTtsProgress(0);
      stopTtsRef.current = false;
      const settings = await (window as any).api?.getSettings();
      const voice = settings?.ttsVoice || 'F1';
      
      const cleanText = content.replace(/[#*`_\[\]()]/g, '');
      const sentences = cleanText.match(/[^.!?\n]+[.!?\n]+/g) || [cleanText];
      
      const parts = sentences.filter((s) => s.trim());
      const total = Math.max(parts.length, 1);
      setTtsProgress(3);
      setTtsState('playing');

      for (let i = 0; i < parts.length; i++) {
        const sentence = parts[i];
        if (stopTtsRef.current) break;

        setTtsProgress(((i + 0.15) / total) * 100);

        const result = await (window as any).api?.speakTTS(sentence.trim(), voice);
        if (stopTtsRef.current) break;

        if (result?.base64Audio) {
          await new Promise<void>((resolve) => {
            const audio = new Audio(result.base64Audio);
            trackAudioElement(audio);
            audioRef.current = audio;
            let dur = 0;

            const updateProgress = () => {
              if (stopTtsRef.current) return;
              const d = dur || (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
              const sentProgress = d > 0 ? audio.currentTime / d : 0;
              setTtsProgress(Math.min(99, ((i + sentProgress) / total) * 100));
            };

            const onMeta = () => {
              if (isFinite(audio.duration) && audio.duration > 0) dur = audio.duration;
            };

            audio.addEventListener('loadedmetadata', onMeta);
            audio.addEventListener('durationchange', onMeta);
            audio.addEventListener('timeupdate', updateProgress);
            audio.onended = () => {
              audio.removeEventListener('timeupdate', updateProgress);
              audio.removeEventListener('loadedmetadata', onMeta);
              audio.removeEventListener('durationchange', onMeta);
              setTtsProgress(((i + 1) / total) * 100);
              resolve();
            };
            audio.onerror = () => {
              audio.removeEventListener('timeupdate', updateProgress);
              resolve();
            };
            audio.play().catch(() => resolve());
          });
        } else {
          setTtsProgress(((i + 1) / total) * 100);
        }
      }
      
      if (!stopTtsRef.current) {
        setTtsProgress(100);
        setTimeout(() => {
          setTtsState('idle');
          setTtsProgress(0);
          setGenVoiceProgress(0);
        }, 900);
      }
    } catch {
      setTtsState('idle');
      setTtsProgress(0);
    }
  };

  const handleGenerateVoiceMessage = async () => {
    setShowPlayMenu(false);
    setIsGeneratingVoice(true);
    setGenVoiceProgress(8);
    try {
      const settings = await (window as any).api?.getSettings();
      const voice = settings?.ttsVoice || 'F1';
      const cleanText = content.replace(/[#*`_\[\]()]/g, '');
      const result = await (window as any).api?.speakTTS(cleanText.trim(), voice, 'auto');
      if (result?.base64Audio) {
        setGenVoiceProgress(100);
        onUpdateAudio?.(result.base64Audio);
      }
    } finally {
      setIsGeneratingVoice(false);
      setTimeout(() => setGenVoiceProgress(0), 600);
    }
  };

  const isPlan = role === 'assistant' && typeof content === 'string' && content.trimStart().startsWith('{') && content.includes('"files"');
  let renderContent = <Markdown content={content} isStreaming={isStreaming} />;

  if (isPlan) {
    const isFinished = content.trimEnd().endsWith('}') || !isStreaming;
    const parsedFiles: { path: string; content: string }[] = [];
    const _parts = content.split(/"path"\s*:\s*"/).slice(1);
    for (const part of _parts) {
      const pMatch = part.match(/^([^"]+)"\s*(?:,\s*"content"\s*:\s*")?/);
      if (pMatch) {
        const pathName = pMatch[1]; let contentPart = '';
        if (part.includes('"content"')) {
          const contentStart = part.indexOf('"content":') + 10;
          const quoteStart = part.indexOf('"', contentStart);
          if (quoteStart !== -1) {
            contentPart = part.substring(quoteStart + 1);
            const endIdx = contentPart.lastIndexOf('"}');
            if (endIdx !== -1) contentPart = contentPart.substring(0, endIdx);
            else if (contentPart.endsWith('"')) contentPart = contentPart.substring(0, contentPart.length - 1);
            contentPart = contentPart.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
        }
        parsedFiles.push({ path: pathName, content: contentPart });
      }
    }
    const projectName = content.match(/"name"\s*:\s*"([^"]+)"/)?.[1] || 'project';

    renderContent = (
      <div className="ai-plan-container">
        <div className="ai-plan-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <CheckSquare size={16} />
            <span>{isFinished ? 'Project Ready' : 'Generating Project Structure...'}</span>
          </div>
          {isFinished && (
            <button
              className="button button-primary"
              style={{ padding: '4px 10px', height: '28px', fontSize: '12px' }}
              onClick={async () => {
                await (window as any).api?.downloadProjectZip(projectName, parsedFiles);
              }}
            >
              <Download size={14} /> Download ZIP
            </button>
          )}
        </div>
        <ul className="ai-plan-file-list">
          {parsedFiles.map((file, idx) => {
            const isCurrent = idx === parsedFiles.length - 1 && !isFinished;
            const isExpanded = !!expandedFiles[file.path];
            return (
              <li key={idx} className={`ai-plan-file-item ${isExpanded ? 'expanded' : ''}`}>
                <div className="ai-plan-file-row" onClick={() => setExpandedFiles(p => ({ ...p, [file.path]: !p[file.path] }))}>
                  {isCurrent ? <Loader size={14} className="ai-spin" /> : <Check size={14} color="var(--green)" />}
                  <span className="ai-plan-file-path">{file.path}</span>
                  <ChevronRight size={14} className="ai-plan-expand-icon" />
                </div>
                {isExpanded && <div className="ai-plan-file-preview"><Markdown content={`\`\`\`${file.path.split('.').pop() || ''}\n${file.content}\n\`\`\``} isStreaming={isCurrent} /></div>}
              </li>
            );
          })}
        </ul>
      </div>
    );
    const statusMatch = content.match(/\n\n---\n\*\*.*$/)?.[0];
    if (statusMatch) renderContent = <>{renderContent}<div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', fontSize: '14px', color: 'var(--text-secondary)' }}><Markdown content={statusMatch} isStreaming={false} /></div></>;
  }

  if (role === 'system') {
    return (
      <div className="ai-msg system">
        <div className="system-command-card">
          <div className="system-command-text">{content}</div>
          <button className="system-command-copy-btn" onClick={onCopy} title="Copy Status">
            {copyDone ? <Check size={12} /> : <Copy size={12} />}
            <span>{copyDone ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`ai-msg ${role}${role !== 'system' ? ' msg-enter' : ''}`}>
      <div className="ai-msg-body">
        <div className="ai-msg-text">
          {reasoning && thinkingMode === 'think' && (
            <details className="ai-reasoning-block" open={isStreaming}>
              <summary>Thinking Process</summary>
              <div className="ai-reasoning-content"><Markdown content={reasoning} /></div>
            </details>
          )}
          {image && <div className="ai-msg-image"><img src={image} alt="User upload" onClick={() => onImageClick?.(image)} /></div>}
          {renderContent}
          {isStreaming && !isPlan && (
            <div className="ai-thinking-spinner" style={{ marginTop: '8px' }}>
              <div className="ai-thinking-dots" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          {audioUrl === 'loading' ? (
            <VoiceProcessingIndicator />
          ) : audioUrl ? (
            <VoiceMessagePlayer
              audioBase64={audioUrl}
              deferAutoplay={deferAutoplay}
              onPlayStart={() => {
                if (audioUrl.startsWith('autoplay:') && onUpdateAudio) {
                  onUpdateAudio(audioUrl.slice(9));
                }
              }}
            />
          ) : null}
          {stats && role === 'assistant' && (
            <div className="ai-msg-stats">
              <span title="Generation Time"><Clock size={10} /> {stats.time}s</span>
              <span title="Tokens spent"><Zap size={10} /> {stats.tokens} tokens</span>
            </div>
          )}
        </div>
        {!isStreaming && !isPlan && (
          <div className="ai-msg-actions">
            {role === 'user' && onEdit && <button className="ai-message-action-btn" onClick={onEdit} title="Edit message"><Edit2 size={13} /></button>}
            {content && (
              <button className={`premium-action-btn ${copyDone ? 'copied' : ''}`} onClick={onCopy} title={copyDone ? 'Copy done' : 'Copy'}>
                <div className="svg-wrapper">
                  <Copy size={14} />
                </div>
                <span>{copyDone ? 'Copied!' : 'Copy'}</span>
              </button>
            )}
            {role === 'assistant' && content && !isPlan && (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                {ttsState === 'loading' || isGeneratingVoice || ttsState === 'playing' ? (
                  <AudioProcessingBar
                    label={ttsState === 'playing' ? 'Audio' : 'Voice'}
                    progress={ttsState === 'playing' ? ttsProgress : genVoiceProgress}
                    onClick={handlePlayTTS}
                    title={ttsState === 'playing' ? 'Stop audio — click' : 'Processing… click to cancel'}
                  />
                ) : (
                  <>
                    <button 
                      className="ai-message-action-btn" 
                      onClick={() => setShowPlayMenu(!showPlayMenu)} 
                      title="Audio Options"
                    >
                      <Volume2 size={13} />
                    </button>
                    {showPlayMenu && (
                      <div className="audio-options-menu">
                        <div className="audio-menu-item" onClick={handlePlayTTS}>
                          <Volume2 size={14} /> Read Aloud
                        </div>
                        <div className="audio-menu-item" onClick={handleGenerateVoiceMessage}>
                          <Mic size={14} /> Voice Message
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {role === 'assistant' && onRegenerate && (
              <button className="ai-message-action-btn" onClick={onRegenerate} title="Regenerate response">
                <RotateCcw size={13} />
                <span>Regenerate</span>
              </button>
            )}
            {onDelete && (
              <button className="ai-message-action-btn ai-delete-btn" onClick={onDelete} title="Delete message and voice">
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // Custom deep comparison to prevent massive re-renders on every streaming chunk
  return (
    prev.role === next.role &&
    prev.content === next.content &&
    prev.reasoning === next.reasoning &&
    prev.image === next.image &&
    prev.audioUrl === next.audioUrl &&
    prev.isStreaming === next.isStreaming &&
    prev.onDelete === next.onDelete &&
    prev.stats?.time === next.stats?.time &&
    prev.stats?.tokens === next.stats?.tokens
  );
});
// v3.0 — React Portal mini mode + React.memo + RAF scroll