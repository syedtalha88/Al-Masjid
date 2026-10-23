import { IconFrame, type IconProps } from '../Icon.tsx';

export function WifiOffIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M48 40l160 176" />
      <path d="M25 98.6A151.6 151.6 0 0 1 72.4 72M231 98.6a151.4 151.4 0 0 0-95.8-42.4" />
      <path d="M59 132.7a104.2 104.2 0 0 1 44.6-24.4M197 132.7a103.6 103.6 0 0 0-22.4-16.6" />
      <path d="M92.9 166.6a56 56 0 0 1 59.8-11.8" />
      <circle cx="128" cy="200" r="8" className="fill-current" />
    </IconFrame>
  );
}
