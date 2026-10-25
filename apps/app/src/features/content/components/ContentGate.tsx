// The content screens' strings (`content`, plus `masjid` for the share sheet and masjid states) load with their chunk;
// until then a blank screen of the right colour — never raw keys.
import { useTranslation } from '@mc/i18n/react';
import type { ReactNode } from 'react';

export function ContentGate({ children }: { readonly children: ReactNode }) {
  const { ready } = useTranslation(['content', 'masjid']);
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <>{children}</>;
}
