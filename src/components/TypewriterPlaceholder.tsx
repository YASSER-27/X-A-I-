import { useEffect, useState } from 'react';

type Props = {
  text: string;
  active?: boolean;
  speedMs?: number;
};

/** Typewriter overlay for empty textarea placeholder lines */
export default function TypewriterPlaceholder({ text, active = true, speedMs = 28 }: Props) {
  const [display, setDisplay] = useState('');
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    if (!active) {
      setDisplay('');
      return;
    }
    setDisplay('');
    let i = 0;
    const typeTimer = window.setInterval(() => {
      i += 1;
      setDisplay(text.slice(0, i));
      if (i >= text.length) window.clearInterval(typeTimer);
    }, speedMs);
    return () => window.clearInterval(typeTimer);
  }, [text, active, speedMs]);

  useEffect(() => {
    if (!active) return;
    const blink = window.setInterval(() => setCursorOn((v) => !v), 530);
    return () => window.clearInterval(blink);
  }, [active, text]);

  if (!active) return null;

  return (
    <span className="ai-typewriter-placeholder" aria-hidden>
      {display}
      <span className={`ai-typewriter-cursor ${cursorOn ? 'on' : ''}`}>|</span>
    </span>
  );
}
