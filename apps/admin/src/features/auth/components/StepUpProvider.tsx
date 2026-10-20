import { useTranslation } from '@mc/i18n/react';
import { ProblemError } from '@mc/shared/http';
import { Dialog } from '@mc/ui/components';
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react';

import { stepUp } from '../lib/flows.ts';
import { PasskeyError } from '../lib/passkey.ts';

/** Runs a ★ action; when the server asks for a step-up, confirms with the screen lock and retries once. */
export type RunWithStepUp = <T>(action: () => Promise<T>) => Promise<T>;

const StepUpContext = createContext<RunWithStepUp | null>(null);

/** Thrown when the admin closes the "Confirm it's you" dialog. */
export class StepUpCancelled extends Error {
  override readonly name = 'StepUpCancelled';
}

const isStepUpRequired = (error: unknown) => error instanceof ProblemError && error.problem.code === 'STEP_UP_REQUIRED';

/**
 * ★ actions and adding a passkey (04 §3, 03 §1): the server answers `STEP_UP_REQUIRED` when the last passkey confirmation is older than
 * 5 minutes. Browsers (Safari) only allow the passkey prompt right after a tap, and the tap that started the action
 * was used up by the request — so a small dialog asks for one more tap, which runs the step-up and then the action
 * again.
 */
export function StepUpProvider({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation('super');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);

  const confirm = useCallback(() => {
    setOpen(true);
    setFailed(false);
    return new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
    });
  }, []);

  const run = useCallback<RunWithStepUp>(
    async (action) => {
      try {
        return await action();
      } catch (error) {
        if (!isStepUpRequired(error)) throw error;
        await confirm();
        return action();
      }
    },
    [confirm],
  );
  const value = useMemo(() => run, [run]);

  return (
    <StepUpContext value={value}>
      {children}
      <Dialog
        open={open}
        title={t('stepUp.title')}
        body={failed ? t('stepUp.failed') : t('stepUp.body')}
        confirmLabel={t('stepUp.confirm')}
        loading={busy}
        onClose={() => {
          setOpen(false);
          pending.current?.reject(new StepUpCancelled());
          pending.current = null;
        }}
        onConfirm={() => {
          setBusy(true);
          stepUp().then(
            () => {
              setBusy(false);
              setOpen(false);
              pending.current?.resolve();
              pending.current = null;
            },
            (error: unknown) => {
              setBusy(false);
              setFailed(true);
              if (!(error instanceof PasskeyError)) {
                setOpen(false);
                pending.current?.reject(error);
                pending.current = null;
              }
            },
          );
        }}
      />
    </StepUpContext>
  );
}

/** The step-up action runner (inside a <StepUpProvider>: the Super Admin screens, the account screen). */
export function useStepUp(): RunWithStepUp {
  const run = use(StepUpContext);
  if (!run) throw new Error('useStepUp() must be used inside <StepUpProvider>');
  return run;
}
