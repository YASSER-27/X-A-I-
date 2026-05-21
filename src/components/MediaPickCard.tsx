import './MediaPickCard.css';

type Props = {
  src: string;
  hoverSrc?: string;
  activeSrc?: string;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
};

export default function MediaPickCard({
  src,
  hoverSrc,
  activeSrc,
  selected = false,
  onClick,
  label,
  size = 'md',
  className = '',
}: Props) {
  const hover = hoverSrc || src;
  const active = activeSrc || src;

  return (
    <button
      type="button"
      className={`media-pick-card group ${size} ${selected ? 'is-selected' : ''} ${className}`.trim()}
      onClick={onClick}
      aria-pressed={selected}
    >
      <div className="media-pick-frame">
        <img src={src} alt="" className="media-pick-img media-pick-normal" draggable={false} />
        <img src={hover} alt="" className="media-pick-img media-pick-hover" draggable={false} />
        <img src={active} alt="" className="media-pick-img media-pick-active" draggable={false} />
      </div>
      {label ? <span className="media-pick-label">{label}</span> : null}
    </button>
  );
}
