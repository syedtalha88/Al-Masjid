import { IconFrame, type IconProps } from '../Icon.tsx';

/** Fingerprint (passkeys / screen lock). */
export function FingerprintIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M72 216a136 136 0 0 0 16-64 40 40 0 0 1 80 0 168 168 0 0 1-8 48" />
      <path d="M128 152a216 216 0 0 1-24 96" />
      <path d="M40 176a144 144 0 0 0 0-24 88 88 0 0 1 168-37" />
      <path d="M216 152a259 259 0 0 1-4 40" />
      <path d="M60 64a120 120 0 0 1 140 0" />
    </IconFrame>
  );
}
