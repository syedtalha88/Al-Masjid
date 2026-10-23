import { IconFrame, type IconProps } from '../Icon.tsx';

/** Bulleted list (my posts). */
export function ListBulletsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 64h120M96 128h120M96 192h120" />
      <circle cx="52" cy="64" r="4" className="fill-current" />
      <circle cx="52" cy="128" r="4" className="fill-current" />
      <circle cx="52" cy="192" r="4" className="fill-current" />
    </IconFrame>
  );
}
