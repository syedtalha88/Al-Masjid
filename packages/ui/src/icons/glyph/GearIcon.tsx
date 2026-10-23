import { IconFrame, type IconProps } from '../Icon.tsx';

/** Gear (masjid profile, settings). */
export function GearIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="36" />
      <path d="M128 24v28M128 204v28M24 128h28M204 128h28M54.5 54.5l19.8 19.8M181.7 181.7l19.8 19.8M54.5 201.5l19.8-19.8M181.7 74.3l19.8-19.8" />
      <circle cx="128" cy="128" r="72" />
    </IconFrame>
  );
}
