import { useEffect, useRef, useState } from 'react';
import { Play, Square, Download } from 'lucide-react';
import { getSharedAnalyser, trackAudioElement } from '../lib/audioAnalyser';

type Props = {
  audioBase64: string;
  onPlayStart?: () => void;
  /** Call mode plays audio centrally; skip hidden-message autoplay. */
  deferAutoplay?: boolean;
};

const BAR_COUNT = 32;

export default function VoiceMessagePlayer({ audioBase64, onPlayStart, deferAutoplay }: Props) {
  const autoPlay = audioBase64.startsWith('autoplay:');
  const actualSrc = autoPlay ? audioBase64.slice(9) : audioBase64;
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [savedDone, setSavedDone] = useState(false);
  const [barHeights, setBarHeights] = useState<number[]>(() => Array(BAR_COUNT).fill(0.2));

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationRef = useRef(0);
  const rafRef = useRef<number>(0);
  const onPlayStartRef = useRef(onPlayStart);
  onPlayStartRef.current = onPlayStart;

  useEffect(() => {
    const audio = new Audio(actualSrc);
    audioRef.current = audio;
    trackAudioElement(audio);

    const syncDuration = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);
      }
    };

    const onTime = () => {
      setCurrentTime(audio.currentTime);
      const d = durationRef.current || (isFinite(audio.duration) ? audio.duration : 0);
      if (d > 0) setProgress(Math.min(100, (audio.currentTime / d) * 100));
    };

    const tickBars = () => {
      const { analyser } = getSharedAnalyser();
      if (analyser && !audio.paused) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
        setBarHeights(
          Array.from({ length: BAR_COUNT }, (_, i) => {
            const v = data[Math.min(i * step, data.length - 1)] / 255;
            return 0.1 + v * 0.9;
          })
        );
      }
      rafRef.current = requestAnimationFrame(tickBars);
    };

    const onPlayHandler = () => {
      getSharedAnalyser();
      syncDuration();
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: true } }));
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tickBars);
    };

    const onPauseHandler = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    };

    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlayHandler);
    audio.addEventListener('pause', onPauseHandler);
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setProgress(100);
      cancelAnimationFrame(rafRef.current);
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    });
    audio.addEventListener('error', () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    });

    if (autoPlay && !deferAutoplay) {
      const tryPlay = () => {
        audio.play().then(() => onPlayStartRef.current?.()).catch(() => {});
      };
      if (audio.readyState >= 2) tryPlay();
      else audio.addEventListener('canplay', tryPlay, { once: true });
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.src = '';
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlayHandler);
      audio.removeEventListener('pause', onPauseHandler);
      window.dispatchEvent(new CustomEvent('ai-audio-play', { detail: { playing: false } }));
    };
  }, [actualSrc, autoPlay, deferAutoplay]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const { context } = getSharedAnalyser();
    if (context?.state === 'suspended') {
      context.resume().catch(() => {});
    }
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setIsPlaying(false));
    }
  };

  const formatTime = (time: number) => {
    if (!isFinite(time) || isNaN(time) || time < 0) return '0:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="vmsg-player">
      <button type="button" className="vmsg-play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="vmsg-body">
        <div className="vmsg-wave" aria-hidden>
          {barHeights.map((h, i) => (
            <span key={i} className={`vmsg-bar ${isPlaying ? 'live' : ''}`} style={{ transform: `scaleY(${h})` }} />
          ))}
        </div>
        <div className="vmsg-track">
          <span className="vmsg-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="vmsg-times">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <button type="button" className={`vmsg-save ${savedDone ? 'saved' : ''}`} onClick={() => {
        const a = document.createElement('a');
        a.href = actualSrc;
        a.download = `voice-${Date.now()}.wav`;
        a.click();
        setSavedDone(true);
        setTimeout(() => setSavedDone(false), 1200);
      }} title="Save WAV">
        <Download size={15} />
      </button>
    </div>
  );
}
