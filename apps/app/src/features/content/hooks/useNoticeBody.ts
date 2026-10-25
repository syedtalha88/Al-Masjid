// The body text of a notice (07 A7): the admin's own words, or the template body (ICU, from `GET /templates`) filled
// with its params formatted for the reader's locale (02 §2). Template bodies need the ICU parser, which only this
// screen family loads (`@mc/i18n/runtime-message`, lazy chunk).
import { useLocale, useTranslation } from '@mc/i18n/react';
import type * as RuntimeMessageModule from '@mc/i18n/runtime-message';
import type { FeedItem } from '@mc/shared/contracts/public';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { templatesQuery } from '../../../lib/api/queries.ts';
import { useAppData } from '../../../lib/data.tsx';
import { noticeMessage, templateArguments } from '../lib/content-view.ts';

type RuntimeMessage = typeof RuntimeMessageModule;
let runtime: RuntimeMessage | null = null;
let loading: Promise<RuntimeMessage> | null = null;
const loadRuntime = (): Promise<RuntimeMessage> => {
  loading ??= import('@mc/i18n/runtime-message').then((module) => {
    runtime = module;
    return module;
  });
  return loading;
};

/** The formatter module once loaded (re-renders when it arrives). */
function useRuntimeMessage(needed: boolean): RuntimeMessage | null {
  const [module, setModule] = useState(runtime);
  useEffect(() => {
    if (!needed || module) return;
    let active = true;
    void loadRuntime().then((loaded) => {
      if (active) setModule(loaded);
    });
    return () => {
      active = false;
    };
  }, [needed, module]);
  return module;
}

/**
 * @returns the body to show; `undefined` while a template body is still loading or when it cannot be formatted (the
 *   title says it all then).
 */
export function useNoticeBody(item: FeedItem): string | undefined {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const { api } = useAppData();
  const templates = useQuery(templatesQuery(api)).data?.templates;
  const template = item.templateKey ? templates?.find((entry) => entry.key === item.templateKey) : undefined;
  const module = useRuntimeMessage(template !== undefined);
  if (!item.templateKey) return item.body?.trim() ? item.body : undefined;
  if (!template || !module) return undefined;
  const values = templateArguments(item.templateParams ?? {}, template.params, {
    time: (hhmm) => format.time(hhmm).text,
    date: (date) => format.calendarDate(date, 'medium'),
    prayer: (name) => t(`prayer.${name}`),
  });
  return module.formatRuntimeMessage(noticeMessage(template, locale), locale, values) ?? undefined;
}
