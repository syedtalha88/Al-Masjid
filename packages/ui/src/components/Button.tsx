import type { MouseEvent, ReactNode } from 'react';

import { Pressable, type PressableProps } from '../motion/Pressable.tsx';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary-700 text-on-primary data-[pressed]:bg-primary-800',
  secondary: 'bg-mint-100 text-primary-800 data-[pressed]:bg-mint-200',
  outline: 'border-[1.5px] border-primary-700 bg-surface text-primary-700 data-[pressed]:bg-mint-50',
  ghost: 'bg-transparent text-primary-700 data-[pressed]:bg-mint-50',
  danger: 'bg-danger text-on-primary data-[pressed]:opacity-90',
};

/** Heights come from the control-size variables (app 48/56 px, admin 56/64 px — 06 §4, §6). */
const SIZE: Readonly<Record<ButtonSize, string>> = {
  md: 'min-h-(--mc-control-md) px-5 type-subhead-strong',
  lg: 'min-h-(--mc-control-lg) px-6 type-headline',
};

export interface ButtonProps extends Omit<PressableProps, 'kind' | 'children'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Stretch to the container width. */
  readonly fullWidth?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
  /** Busy: a spinner replaces the leading icon (or overlays the label), width stays locked, presses ignored. */
  readonly loading?: boolean;
  readonly children: ReactNode;
}

/**
 * Button (06 §6 Controls): primary · secondary (mint, "Read Full") · outline ("Add Another Masjid", "Share") ·
 * ghost · danger; md / lg ("Donate Now"); leading/trailing icon; loading and disabled states. Press feedback
 * and keyboard activation come from `Pressable`.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  loading = false,
  onPress,
  className,
  children,
  ...rest
}: ButtonProps) {
  const overlaySpinner = loading && !leadingIcon;
  return (
    <Pressable
      {...rest}
      aria-busy={loading || undefined}
      aria-disabled={loading || rest.disabled || undefined}
      onPress={(event: MouseEvent<HTMLButtonElement>) => {
        if (!loading) onPress?.(event);
      }}
      className={`relative inline-flex items-center justify-center gap-2 rounded-full text-center transition-state disabled:opacity-40 ${
        VARIANT[variant]
      } ${SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
    >
      {leadingIcon ? (
        <span className="inline-flex shrink-0" aria-hidden>
          {loading ? <Spinner /> : leadingIcon}
        </span>
      ) : null}
      <span className={overlaySpinner ? 'opacity-0' : undefined}>{children}</span>
      {trailingIcon ? (
        <span className={`inline-flex shrink-0 ${overlaySpinner ? 'opacity-0' : ''}`} aria-hidden>
          {trailingIcon}
        </span>
      ) : null}
      {overlaySpinner ? (
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <Spinner />
        </span>
      ) : null}
    </Pressable>
  );
}

export type IconButtonVariant = 'plain' | 'tinted' | 'onImage' | 'onImageBare';

const ICON_VARIANT: Readonly<Record<IconButtonVariant, string>> = {
  plain: 'size-10 text-text group-data-[pressed]:bg-surface-muted',
  tinted: 'size-10 bg-mint-50 text-primary-700 group-data-[pressed]:bg-mint-100',
  onImage: 'size-9 bg-surface text-text shadow-e1 group-data-[pressed]:bg-surface-muted',
  onImageBare: 'size-10 text-on-primary drop-shadow-sm',
};

export interface IconButtonProps extends Omit<PressableProps, 'kind' | 'children' | 'aria-label'> {
  /** Required accessible name (i18n) — icon-only buttons always have one (06 §7). */
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant?: IconButtonVariant;
}

/**
 * Circular icon-only button (06 §6). The visible circle is 36–40 px; the hit area is always ≥ 44 px (56 px in
 * admin). `onImage` = white circle with shadow for hero overlays; `onImageBare` = white glyph on the hero
 * scrim (ref-1 back chevron).
 */
export function IconButton({ label, icon, variant = 'plain', className, ...rest }: IconButtonProps) {
  return (
    <Pressable
      {...rest}
      aria-label={label}
      className={`group inline-flex size-(--mc-hit) shrink-0 items-center justify-center rounded-full ${className ?? ''}`}
    >
      <span
        className={`inline-flex items-center justify-center rounded-full transition-state ${ICON_VARIANT[variant]}`}
        aria-hidden
      >
        {icon}
      </span>
    </Pressable>
  );
}

export interface CircleActionProps extends Omit<PressableProps, 'kind' | 'children'> {
  readonly icon: ReactNode;
  readonly label: string;
}

/** Quick action: 44 px mint circle + caption label below (Notifications / Share / Directions — ref-1). */
export function CircleAction({ icon, label, className, ...rest }: CircleActionProps) {
  return (
    <Pressable
      {...rest}
      className={`group inline-flex min-w-16 flex-col items-center gap-1.5 px-1 text-primary-700 ${className ?? ''}`}
    >
      <span
        className="inline-flex size-11 items-center justify-center rounded-full bg-mint-50 transition-state group-data-[pressed]:bg-mint-100"
        aria-hidden
      >
        {icon}
      </span>
      <span className="type-caption text-text-secondary">{label}</span>
    </Pressable>
  );
}
