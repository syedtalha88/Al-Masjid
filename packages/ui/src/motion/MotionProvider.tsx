import { type FeatureBundle, LazyMotion, MotionConfig } from 'motion/react';
import { createContext, type ReactNode, use, useMemo } from 'react';

import { useLiteMotion } from './lite.ts';
import { useReducedMotionPref } from './reduced.ts';
import { tween } from './tokens.ts';

export interface MotionPrefs {
  /** OS asks for reduced motion → crossfades only (08 §6). */
  readonly reduced: boolean;
  /** Low-end device or session jank → drop expensive effects (08 §6). */
  readonly lite: boolean;
}

const MotionPrefsContext = createContext<MotionPrefs>({ reduced: false, lite: false });

const loadFeatures = () => import('./features.ts').then((module) => module.default);

export interface MotionProviderProps {
  readonly children: ReactNode;
  /** Feature bundle; defaults to a lazy `domAnimation` chunk. Tests pass the bundle synchronously. */
  readonly features?: FeatureBundle | (() => Promise<FeatureBundle>);
}

/**
 * Root motion setup: `LazyMotion` (strict — only `m.*` components) with lazily loaded features, Motion's own
 * reduced-motion handling as a safety net, and the reduced/lite preferences for our components.
 */
export function MotionProvider({ children, features = loadFeatures }: MotionProviderProps) {
  const reduced = useReducedMotionPref();
  const lite = useLiteMotion();
  const prefs = useMemo(() => ({ reduced, lite }), [reduced, lite]);
  return (
    <MotionPrefsContext value={prefs}>
      <LazyMotion features={features} strict>
        <MotionConfig reducedMotion="user" {...(reduced ? { transition: tween.fade } : {})}>
          {children}
        </MotionConfig>
      </LazyMotion>
    </MotionPrefsContext>
  );
}

/** Reduced / lite motion preferences (inside `MotionProvider`; defaults to full motion outside it). */
export function useMotionPrefs(): MotionPrefs {
  return use(MotionPrefsContext);
}
