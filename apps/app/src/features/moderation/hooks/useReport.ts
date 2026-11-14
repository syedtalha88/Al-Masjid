// Sending a report (00 §4.7, PHASE_08 T8.1): registers the device first if it is not yet, takes a fresh Turnstile token
// and posts the report. Nothing is queued offline — a report is sent now or the person is told to try again. The
// report never hides anything by itself; the reporter only learns that it arrived.
import type { ReportReason } from '@mc/shared/compliance';
import { NetworkError, ProblemError } from '@mc/shared/http';
import { useState } from 'react';

import { useAppData } from '../../../lib/data.tsx';
import { ensureRegistered } from '../../../lib/device/sync.ts';

export type ReportTarget =
  { readonly kind: 'item'; readonly publicId: string } | { readonly kind: 'masjid'; readonly masjidId: string };

/** Why sending failed, for the sheet's message. */
export type ReportProblem = 'offline' | 'limit' | 'gone' | 'failed';

export type ReportState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending' }
  | { readonly status: 'sent' }
  | { readonly status: 'error'; readonly problem: ReportProblem };

/** The problem a failed send maps to (exported for tests). */
export function reportProblem(error: unknown): ReportProblem {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ProblemError) {
    if (error.status === 429) return 'limit';
    if (error.status === 404) return 'gone';
  }
  return 'failed';
}

export function useReport(target: ReportTarget) {
  const { api, sync } = useAppData();
  const [state, setState] = useState<ReportState>({ status: 'idle' });

  const send = async (reason: ReportReason, details: string) => {
    setState({ status: 'sending' });
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new NetworkError('failed');
      await ensureRegistered(sync);
      const turnstileToken = await sync.turnstileToken();
      const text = details.trim();
      await api.report({
        targetType: target.kind,
        targetPublicId: target.kind === 'item' ? target.publicId : target.masjidId,
        reason,
        ...(text === '' ? {} : { details: text }),
        turnstileToken,
      });
      setState({ status: 'sent' });
    } catch (error) {
      setState({ status: 'error', problem: reportProblem(error) });
    }
  };

  const reset = () => {
    setState({ status: 'idle' });
  };

  return { state, send, reset };
}
