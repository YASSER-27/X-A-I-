import { useState, useEffect } from 'react';
import './Intro.css';

export default function Intro({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<'fade-in' | 'visible' | 'fade-out' | 'hidden'>('fade-in');

  useEffect(() => {
    // Fast intro: total duration ~2s
    const timer1 = setTimeout(() => setStage('visible'), 180);
    const timer2 = setTimeout(() => setStage('fade-out'), 1500);
    const timer3 = setTimeout(() => {
      setStage('hidden');
      onComplete();
    }, 2000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  if (stage === 'hidden') return null;

  return (
    <div className={`intro-overlay ${stage}`}>
      <div className="intro-content">
        <h1 className="intro-title">X AI</h1>
        <h2 className="intro-title">27</h2>
      </div>
    </div>
  );
}
