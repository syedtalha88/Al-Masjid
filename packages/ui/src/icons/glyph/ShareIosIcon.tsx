import { IconFrame, type IconProps } from '../Icon.tsx';

/** iOS "Share" (box with up arrow) — used in the Add to Home Screen guide. */
export function ShareIosIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M176 104h24a8 8 0 0 1 8 8v96a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8v-96a8 8 0 0 1 8-8h24" />
      <path d="M88 64l40-40 40 40M128 24v112" />
    </IconFrame>
  );
}
