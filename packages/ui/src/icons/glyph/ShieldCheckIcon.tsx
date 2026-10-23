import { IconFrame, type IconProps } from '../Icon.tsx';

/** Shield with check (undertaking, verified actions). */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 112V56a8 8 0 0 1 8-8h160a8 8 0 0 1 8 8v56c0 84-88 112-88 112S40 196 40 112Z" />
      <path d="M88 136l24 24 56-56" />
    </IconFrame>
  );
}
