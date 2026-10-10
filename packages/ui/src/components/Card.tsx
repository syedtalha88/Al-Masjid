import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { Pressable, type PressableProps } from '../motion/Pressable.tsx';

export type CardVariant = 'plain' | 'mint' | 'outline';

const VARIANT: Readonly<Record<CardVariant, string>> = {
  plain: 'bg-surface shadow-e1',
  mint: 'bg-mint-50',
  outline: 'border border-border bg-surface',
};

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  readonly variant?: CardVariant;
  /** Remove the default 16 px padding (cards with full-bleed media). */
  readonly flush?: boolean;
}

/** Card (06 §6): radius 16, padding 16, very soft `e1` shadow (plain), mint information panel, or outline. */
export function Card({ variant = 'plain', flush = false, className, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={`rounded-md ${VARIANT[variant]} ${flush ? '' : 'p-4'} ${className ?? ''}`}>
      {children}
    </div>
  );
}

export interface PressableCardProps extends Omit<PressableProps, 'kind'> {
  readonly variant?: CardVariant;
  readonly flush?: boolean;
  readonly children: ReactNode;
}

/** A whole card that is one tap target (press scale 0.98). Content inside must not contain other buttons. */
export function PressableCard({ variant = 'plain', flush = false, className, children, ...rest }: PressableCardProps) {
  return (
    <Pressable
      {...rest}
      kind="card"
      className={`block w-full rounded-md text-start ${VARIANT[variant]} ${flush ? '' : 'p-4'} ${className ?? ''}`}
    >
      {children}
    </Pressable>
  );
}
