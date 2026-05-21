/** Shared processing bar (TTS / voice message generation). */

type AudioProcessingBarProps = {
  label?: string;
  progress: number;
  onClick?: () => void;
  title?: string;
};

export default function AudioProcessingBar({
  label = 'Processing',
  progress,
  onClick,
  title,
}: AudioProcessingBarProps) {
  const pct = Math.round(Math.min(100, Math.max(0, progress)));
  const done = pct >= 100;

  return (
    <div
      className="audio-processing-bar"
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
    >
      <div className="audio-processing-bar__fill" style={{ width: `${pct}%` }} />
      <span className="audio-processing-bar__text">
        {done ? 'Completed' : `${label} · ${pct}%`}
      </span>
    </div>
  );
}
