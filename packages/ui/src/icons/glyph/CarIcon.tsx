import { IconFrame, type IconProps } from '../Icon.tsx';

/** Parking — Phosphor `car` (regular), MIT (../PHOSPHOR_LICENSE). */
export function CarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <line x1="16" y1="112" x2="240" y2="112" />
      <path d="M224,176v24a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V176" />
      <path d="M72,176v24a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V176" />
      <line x1="64" y1="144" x2="80" y2="144" />
      <line x1="176" y1="144" x2="192" y2="144" />
      <path d="M224,112,194.11,44.75A8,8,0,0,0,186.8,40H69.2a8,8,0,0,0-7.31,4.75L32,112v64H224Z" />
    </IconFrame>
  );
}
