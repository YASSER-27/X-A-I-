import { Send } from 'lucide-react';

interface FlySendButtonProps {
  disabled?: boolean;
  exiting?: boolean;
  onClick: () => void;
  title?: string;
  shake?: boolean;
}

/** Same look as .ai-send-btn — exit animation only */
export default function FlySendButton({ disabled, exiting, onClick, title = 'Send', shake }: FlySendButtonProps) {
  return (
    <button
      type="button"
      className={`ai-send-btn fly-send-exit-btn ${exiting ? 'fly-send-exit-btn--leaving' : ''} ${shake ? 'button-shake' : ''}`}
      disabled={disabled || exiting}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <Send size={16} />
    </button>
  );
}
