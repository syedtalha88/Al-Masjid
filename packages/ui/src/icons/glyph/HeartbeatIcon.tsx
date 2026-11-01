import { IconFrame, type IconProps } from '../Icon.tsx';

/** Health (blood donation) — Phosphor `heartbeat` (regular), MIT (../PHOSPHOR_LICENSE). */
export function HeartbeatIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <polyline points="32 136 72 136 88 112 120 160 136 136 160 136" />
      <path d="M24,104c0-.67,0-1.33,0-2A54,54,0,0,1,78,48c22.59,0,41.94,12.31,50,32,8.06-19.69,27.41-32,50-32a54,54,0,0,1,54,54c0,66-104,122-104,122s-42-22.6-72.58-56" />
    </IconFrame>
  );
}
