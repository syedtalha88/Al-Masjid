import type { Namespace } from '@mc/i18n';
import { directionOf, type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { LocaleScope, useLocale } from '@mc/i18n/react';
import { type ReactNode, useEffect, useRef } from 'react';

import { SegmentedControl } from '../components/SegmentedControl.tsx';
import { Skeleton, SkeletonText } from '../components/Skeleton.tsx';
import { crossfadeIn } from '../motion/effects.ts';

/** What the musalli cards inside the frame need loaded by default (`@mc/ui/content` item cards). */
const PREVIEW_NAMESPACES: readonly Namespace[] = ['common', 'content'];

const SEGMENTS = LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }));

export interface PreviewFrameProps {
  /** The language the preview shows (a musalli with that app language). */
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  /** Accessible name of the preview region ("Preview"). */
  readonly label: string;
  /** Accessible name of the language switcher ("Show in"). */
  readonly languageLabel: string;
  /** The musalli rendering — `@mc/ui/content` components, never a copy of them (T3.11). */
  readonly children: ReactNode;
  /** The musalli namespaces the content needs (default: the item cards'; the timings table needs `masjid`). */
  readonly namespaces?: readonly Namespace[];
  readonly className?: string;
}

/**
 * Preview before publishing (06 §6 admin, 07 B4–B7): the musalli rendering inside a phone-shaped frame, with a
 * language switcher showing how each language sees it. The content gets its own i18n instance (`LocaleScope`), its
 * own `lang`/`dir` (Urdu mirrors inside the frame only) and the musalli type scale (`.mc-preview`); the admin UI
 * around it keeps its language. A language change crossfades (08 §5.11).
 */
export function PreviewFrame({
  locale,
  onLocaleChange,
  label,
  languageLabel,
  children,
  namespaces = PREVIEW_NAMESPACES,
  className,
}: PreviewFrameProps) {
  return (
    <section aria-label={label} className={`flex flex-col gap-4 ${className ?? ''}`}>
      <SegmentedControl label={languageLabel} segments={SEGMENTS} value={locale} onChange={onLocaleChange} />
      <div className="mx-auto w-full max-w-sm rounded-xl bg-surface-muted p-2 shadow-e2">
        <div className="min-h-64 overflow-hidden rounded-lg bg-bg">
          <LocaleScope locale={locale} namespaces={namespaces} fallback={<PreviewSkeleton />}>
            <PreviewScreen>{children}</PreviewScreen>
          </LocaleScope>
        </div>
      </div>
    </section>
  );
}

/** The frame's screen in the scope's language (the shown one — it changes only once the next has loaded). */
function PreviewScreen({ children }: { readonly children: ReactNode }) {
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = ref.current;
    if (!element) return;
    const effect = crossfadeIn(element);
    return () => {
      effect.stop();
    };
  }, [locale]);
  return (
    <div ref={ref} lang={locale} dir={directionOf(locale)} className="mc-preview p-4" data-preview-locale={locale}>
      {children}
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div aria-busy className="flex gap-3 p-4">
      <Skeleton className="size-12 rounded-full" />
      <SkeletonText lines={3} className="flex-1" />
    </div>
  );
}
