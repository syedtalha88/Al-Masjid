import { IconFrame, type IconProps } from './Icon.tsx';

/** Dome + minaret glyph (06 §5 "masjid placeholder"). Uses `currentColor`. */
export function MasjidGlyph(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 208H224" />
      <path d="M80 208v-68h96v68" />
      <path d="M84 140c0-36 28-48 44-64 16 16 44 28 44 64" />
      <path d="M128 76V56" />
      <path d="M112 208v-24a16 16 0 0 1 32 0v24" />
      <path d="M208 208V112" />
      <path d="M196 112l12-24 12 24Z" />
    </IconFrame>
  );
}

const TILE_SIZE = {
  md: { box: 'size-11 rounded-sm', glyph: 24 },
  lg: { box: 'size-14 rounded-md', glyph: 30 },
} as const;

/**
 * Green rounded-square masjid tile with the white glyph (ref-1 Home card). Shown when a masjid has no photo.
 *
 * @param size - `md` 44px (lists) or `lg` 56px (cards).
 */
export function MasjidTile({
  size = 'lg',
  title,
}: {
  readonly size?: keyof typeof TILE_SIZE;
  readonly title?: string;
}) {
  const { box, glyph } = TILE_SIZE[size];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center bg-primary-700 text-on-primary ${box}`}>
      <MasjidGlyph size={glyph} {...(title ? { title } : {})} />
    </span>
  );
}
