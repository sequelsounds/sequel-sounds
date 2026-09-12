/**
 * Every symbol the tool draws.
 *
 * Not typed as characters. Creato Display has no glyph for ▶ ❚ ⏮ ⏭ ⋮ ▾ ▸ —
 * measured, not assumed — so each of those fell back to whatever face the
 * browser had to hand and rendered as something between wrong and unreadable,
 * differently per machine. Drawn marks look the same everywhere and take
 * `currentColor`, so they invert with the row like the text does.
 *
 * ↑ ↓ × + are in the font and stay as characters.
 */
type IconProps = { className?: string; size?: number | string }

function Svg({
  className = '',
  size = '1rem',
  children,
  fill = 'none',
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </Svg>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <rect x="8" y="5.5" width="3" height="13" />
      <rect x="14" y="5.5" width="3" height="13" />
    </Svg>
  )
}

export function PrevIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <path d="M18 6v12l-9-6z" />
      <rect x="5" y="6" width="2.5" height="12" />
    </Svg>
  )
}

export function NextIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <path d="M6 6v12l9-6z" />
      <rect x="16.5" y="6" width="2.5" height="12" />
    </Svg>
  )
}

/** The ⋮ that opens a menu. */
export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </Svg>
  )
}

/** Points down; rotate it for the collapsed state. */
export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </Svg>
  )
}

/** The drag handle on a track row. */
export function GripIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="16"
      viewBox="0 0 10 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="2" cy="3" r="1.15" />
      <circle cx="8" cy="3" r="1.15" />
      <circle cx="2" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="2" cy="13" r="1.15" />
      <circle cx="8" cy="13" r="1.15" />
    </svg>
  )
}

/** Track details. The supplied mark, minus its opaque white backing rect. */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11V17" />
      <path d="M11.75 8V7H12.25V8H11.75Z" />
    </Svg>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </Svg>
  )
}
