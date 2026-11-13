// Contact & Grievance form (00 §4.7, 05 §3, 07 A15 §8, PHASE_08 T8.4): a category (big cards — no typing needed), what
// happened (≤ 2000), an e-mail or phone only if the person wants a reply (sealed on the server — DECISIONS #173), Send
// with Turnstile; then the reference `GR-YYYY-NNNNNN` and "We will acknowledge within 24 hours". No account, nothing
// kept on the phone. Offline: said so, nothing queued.
import { useTranslation } from '@mc/i18n/react';
import { NetworkError, ProblemError } from '@mc/shared/http';
import { Button, Card, RadioCardGroup, TextArea, TextField } from '@mc/ui/components';
import { CheckCircleIcon, WarningIcon } from '@mc/ui/icons';
import { useState } from 'react';

import { useAppData } from '../../lib/data.tsx';

const CATEGORIES = ['privacy', 'content', 'technical', 'feedback', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
const DESCRIPTION_MAX = 2000;
const CONTACT_MAX = 200;

const CATEGORY_KEY = {
  privacy: 'grievanceForm.categories.privacy',
  content: 'grievanceForm.categories.content',
  technical: 'grievanceForm.categories.technical',
  feedback: 'grievanceForm.categories.feedback',
  other: 'grievanceForm.categories.other',
} as const satisfies Readonly<Record<Category, string>>;

type Problem = 'offline' | 'limit' | 'contactUnavailable' | 'failed';
const PROBLEM_KEY = {
  offline: 'grievanceForm.offline',
  limit: 'grievanceForm.limit',
  contactUnavailable: 'grievanceForm.contactUnavailable',
  failed: 'grievanceForm.failed',
} as const satisfies Readonly<Record<Problem, string>>;

/** What the form says when sending failed (exported for tests). */
export function grievanceProblem(error: unknown): Problem {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ProblemError) {
    if (error.status === 429) return 'limit';
    if (error.problem.code === 'GRIEVANCE_CONTACT_UNAVAILABLE') return 'contactUnavailable';
  }
  return 'failed';
}

export function GrievanceForm() {
  const { t } = useTranslation('settings');
  const { api, sync } = useAppData();
  const [category, setCategory] = useState<Category | null>(null);
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const send = async () => {
    if (!category || description.trim() === '') return;
    setSending(true);
    setProblem(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new NetworkError('failed');
      const turnstileToken = await sync.turnstileToken();
      const text = contact.trim();
      setReference(
        await api.grievance({
          category,
          description: description.trim(),
          ...(text === '' ? {} : { contact: text }),
          turnstileToken,
        }),
      );
    } catch (error) {
      setProblem(grievanceProblem(error));
    } finally {
      setSending(false);
    }
  };

  if (reference) {
    return (
      <Card className="flex flex-col items-center gap-2 text-center" data-grievance-sent>
        <CheckCircleIcon size={40} className="text-primary-500" />
        <h2 className="type-headline text-text">{t('grievanceForm.doneTitle')}</h2>
        <p className="type-body text-text">
          {t('grievanceForm.doneRef')}{' '}
          <bdi dir="ltr" className="type-subhead-strong" data-grievance-ref>
            {reference}
          </bdi>
        </p>
        <p className="type-callout text-text-secondary">{t('grievanceForm.doneAck')}</p>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="grievance-form-title" data-grievance-form>
      <h2 id="grievance-form-title" className="type-title3 text-text">
        {t('grievanceForm.title')}
      </h2>
      <RadioCardGroup
        legend={t('grievanceForm.category')}
        name="grievance-category"
        value={category}
        onChange={setCategory}
        options={CATEGORIES.map((value) => ({ value, title: t(CATEGORY_KEY[value]) }))}
      />
      <TextArea
        label={t('grievanceForm.description')}
        hint={t('grievanceForm.descriptionHint')}
        maxLength={DESCRIPTION_MAX}
        rows={6}
        dir="auto"
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
      />
      <TextField
        label={t('grievanceForm.contact')}
        optional
        hint={t('grievanceForm.contactHint')}
        maxLength={CONTACT_MAX}
        dir="auto"
        autoComplete="off"
        value={contact}
        onChange={(event) => {
          setContact(event.target.value);
        }}
      />
      {problem ? (
        <p className="flex items-start gap-2 type-callout text-danger" role="alert" data-grievance-error={problem}>
          <WarningIcon size={20} className="mt-0.5 shrink-0" />
          {t(PROBLEM_KEY[problem])}
        </p>
      ) : null}
      <Button
        size="lg"
        fullWidth
        disabled={category === null || description.trim() === ''}
        loading={sending}
        onPress={() => {
          void send();
        }}
      >
        {sending ? t('grievanceForm.sending') : t('grievanceForm.send')}
      </Button>
    </section>
  );
}
