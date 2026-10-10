import { IconFrame, type IconProps } from './Icon.tsx';

export const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type Prayer = (typeof PRAYERS)[number];

/** Path data per prayer (06 §5), drawn on the 256 grid to match Phosphor's stroke. */
const PATHS: Readonly<Record<Prayer, readonly string[]>> = {
  // Sun rising on the horizon with an up-arrow.
  fajr: [
    'M24 192H232',
    'M80 192a48 48 0 0 1 96 0',
    'M128 104V40',
    'M100 68l28-28 28 28',
    'M56 144 40 128',
    'M200 144l16-16',
    'M88 224h80',
  ],
  // Full sun with eight rays.
  dhuhr: [
    'M128 84a44 44 0 1 1 0 88 44 44 0 0 1 0-88Z',
    'M128 60V36',
    'M128 196v24',
    'M60 128H36',
    'M196 128h24',
    'M80 80 63 63',
    'M176 80l17-17',
    'M80 176l-17 17',
    'M176 176l17 17',
  ],
  // Lower sun and a post casting a long shadow.
  asr: [
    'M92 64a36 36 0 1 1 0 72 36 36 0 0 1 0-72Z',
    'M92 40V24',
    'M32 100H16',
    'M50 58 39 47',
    'M134 58l11-11',
    'M50 142l-11 11',
    'M24 216H232',
    'M184 216v-80',
    'M184 216l48-16',
  ],
  // Half sun setting on the horizon.
  maghrib: [
    'M24 168H232',
    'M76 168a52 52 0 0 1 104 0',
    'M128 100V76',
    'M76 116 60 100',
    'M180 116l16-16',
    'M64 200h128',
    'M96 232h64',
  ],
  // Crescent and star.
  isha: ['M105.5 56.7A84 84 0 1 0 195 168.5 72 72 0 0 1 105.5 56.7Z', 'M196 28l8 16 16 8-16 8-8 16-8-16-16-8 16-8Z'],
};

/**
 * Custom prayer icon (06 §5). Color comes from the parent (`text-sun`, `text-primary-700`…).
 *
 * @param prayer - which of the five daily prayers.
 */
export function PrayerIcon({ prayer, ...props }: IconProps & { readonly prayer: Prayer }) {
  return (
    <IconFrame {...props}>
      {PATHS[prayer].map((d) => (
        <path key={d} d={d} />
      ))}
    </IconFrame>
  );
}
