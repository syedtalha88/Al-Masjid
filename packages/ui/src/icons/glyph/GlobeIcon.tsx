import { IconFrame, type IconProps } from '../Icon.tsx';

/** Globe (language). */
export function GlobeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M32 128h192" />
      <path d="M128 32c-26 26-40 60-40 96s14 70 40 96c26-26 40-60 40-96s-14-70-40-96Z" />
    </IconFrame>
  );
}
