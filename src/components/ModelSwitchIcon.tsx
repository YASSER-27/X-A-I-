type Props = { size?: number; className?: string };

/** Layered chip icon for model switcher (offline UI, no emoji). */
export default function ModelSwitchIcon({ size = 16, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.2l5 2.8v5.6L12 19.4 7 16.6v-5.6l5-2.8z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" />
    </svg>
  );
}
