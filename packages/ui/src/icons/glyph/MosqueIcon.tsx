import { IconFrame, type IconProps } from '../Icon.tsx';

/** Masjid / Jumu’ah — Phosphor `mosque` (regular), MIT (../PHOSPHOR_LICENSE). */
export function MosqueIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <line x1="208" y1="128" x2="48" y2="128" />
      <path d="M208,152a16,16,0,0,1,16-16h0a16,16,0,0,1,16,16v56H208" />
      <path d="M48,208H16V152a16,16,0,0,1,16-16h0a16,16,0,0,1,16,16" />
      <path d="M48,208V128c0-64,80-72,80-104,0,32,80,40,80,104v80H176V176a16,16,0,0,0-16-16h0a16,16,0,0,0-16,16v32H112V176a16,16,0,0,0-16-16h0a16,16,0,0,0-16,16v32Z" />
    </IconFrame>
  );
}
