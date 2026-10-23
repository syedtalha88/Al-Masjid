// "Enter code" sheet (07 A4): the 8-character follow code as two groups of four boxes (ABCD-EFGH), upper-cased as
// typed, paste-friendly (dashes/spaces and a pasted follow link are accepted), submitted automatically once complete.
// One real <input> sits over the boxes, so the keyboard, paste, autofill and screen readers all see a normal field.
import { FOLLOW_CODE_LENGTH, followCodeFromScan, normalizeFollowCode } from '@mc/domain/follow-code';
import { useTranslation } from '@mc/i18n/react';
import type { MasjidSummary } from '@mc/shared/contracts/public';
import { Button, Sheet } from '@mc/ui/components';
import { shake, useMotionPrefs } from '@mc/ui/motion';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { useAppData } from '../../lib/data.tsx';
import { type LookupFailure, lookupFailure, resolveKey } from './lookup.ts';

/** Keeps what can be part of a code: letters and digits, upper-cased, at most 8 (a pasted link → its code). */
export function codeInput(raw: string, origin: string = window.location.origin): string {
  const fromLink = raw.includes('/') ? followCodeFromScan(raw, origin) : null;
  if (fromLink) return fromLink;
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, FOLLOW_CODE_LENGTH);
}

export interface EnterCodeSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The code matched a masjid. */
  readonly onFound: (masjid: MasjidSummary) => void;
}

type Problem = 'invalid' | LookupFailure;

export function EnterCodeSheet({ open, onClose, onFound }: EnterCodeSheetProps) {
  const { t } = useTranslation('follow');
  const { t: te } = useTranslation('errors');
  const { api } = useAppData();
  const queryClient = useQueryClient();
  const { reduced } = useMotionPrefs();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [focused, setFocused] = useState(false);
  const boxes = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const submitted = useRef<string | null>(null);

  // A fresh field every time the sheet opens.
  const [openedFor, setOpenedFor] = useState(open);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setValue('');
      setProblem(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    submitted.current = null;
    // After the sheet has focused its title: the keyboard comes up at once.
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [open]);

  const fail = (next: Problem) => {
    setProblem(next);
    if (boxes.current && !reduced) shake(boxes.current);
  };

  const submit = async (raw: string) => {
    const code = normalizeFollowCode(raw);
    if (!code) {
      fail('invalid');
      return;
    }
    if (busy || submitted.current === code) return;
    submitted.current = code;
    setBusy(true);
    setProblem(null);
    try {
      const masjid = await queryClient.query({
        queryKey: resolveKey(code),
        queryFn: ({ signal }) => api.resolve(code, signal),
        staleTime: 60_000,
      });
      onFound(masjid);
    } catch (error) {
      submitted.current = null;
      fail(lookupFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const message: Record<Problem, string> = {
    invalid: t('code.invalid'),
    'not-found': te('MASJID_NOT_FOUND'),
    offline: te('NETWORK'),
    failed: te('INTERNAL_ERROR'),
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('code.title')}
      footer={
        <Button
          size="lg"
          fullWidth
          loading={busy}
          disabled={value.length < FOLLOW_CODE_LENGTH}
          onPress={() => void submit(value)}
        >
          {t('code.submit')}
        </Button>
      }
    >
      <p className="type-body text-text-secondary">{t('code.body')}</p>
      <div ref={boxes} dir="ltr" className="relative mx-auto mt-6 w-full max-w-sm">
        <div aria-hidden className="flex items-center gap-1.5">
          {Array.from({ length: FOLLOW_CODE_LENGTH }, (_, index) => (
            <CodeBox
              key={index}
              char={value[index]}
              gapBefore={index === FOLLOW_CODE_LENGTH / 2}
              active={focused && index === Math.min(value.length, FOLLOW_CODE_LENGTH - 1)}
              error={problem !== null}
            />
          ))}
        </div>
        <input
          ref={input}
          value={value}
          onChange={(event) => {
            const next = codeInput(event.target.value);
            setValue(next);
            setProblem(null);
            if (next.length === FOLLOW_CODE_LENGTH) void submit(next);
          }}
          aria-label={t('code.label')}
          aria-invalid={problem !== null}
          aria-describedby={problem ? errorId : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="text"
          maxLength={64}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit(value);
          }}
          className="absolute inset-0 size-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
        />
      </div>
      <p id={errorId} role="alert" className="mt-4 min-h-5 text-center type-footnote text-danger">
        {problem ? message[problem] : ''}
      </p>
    </Sheet>
  );
}

function CodeBox({
  char,
  gapBefore,
  active,
  error,
}: {
  readonly char: string | undefined;
  readonly gapBefore: boolean;
  readonly active: boolean;
  readonly error: boolean;
}) {
  const ring = error ? 'border-danger' : active ? 'border-primary-600 ring-2 ring-primary-600/25' : 'border-border';
  return (
    <>
      {gapBefore ? <span className="w-3 shrink-0 text-center type-title2 text-text-tertiary">-</span> : null}
      <span
        className={`flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border-2 bg-surface type-title2 text-text tabular-nums transition-colors ${ring}`}
      >
        {char ?? ''}
      </span>
    </>
  );
}
