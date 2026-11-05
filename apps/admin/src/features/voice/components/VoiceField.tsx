// B14 Voice note recorder (07 B14, DECISIONS #104, DECISIONS #126, PHASE_03 T3.13): inside the notice, hadith / ayah and dua flows.
// The ownership tick first; then record (live level, timer to 10:00 with auto-stop, pause / resume, stop) or "Choose
// audio file"; play the recording back, "Use this" (measured and uploaded) or "Record again". An attached note shows the
// player, "Remove voice note" and — when the post has no title of its own — the title field a voice note needs.
import { useTranslation } from '@mc/i18n/react';
import { Button, Checkbox, Spinner, TextField, useToast, VoiceNote } from '@mc/ui/components';
import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useRecorder } from '../hooks/use-recorder.ts';
import { measureRecording, VOICE_MAX_SECONDS } from '../lib/measure.ts';
import { type AttachedVoice, VOICE_TITLE_MAX } from '../lib/voice.ts';

const AUDIO_TYPES = 'audio/*';
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export interface VoiceFieldProps {
  readonly masjidId: string | undefined;
  readonly voice: AttachedVoice | null | undefined;
  readonly onVoice: (voice: AttachedVoice | null) => void;
  /** The voice note's title field — for posts without a title of their own. */
  readonly title?: { readonly value: string; readonly onChange: (value: string) => void } | undefined;
}

export function VoiceField({ masjidId, voice, onVoice, title }: VoiceFieldProps) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const recorder = useRecorder();
  const [rights, setRights] = useState(voice !== null && voice !== undefined);
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: Blob) => {
      const measured = await measureRecording(file).catch(() => {
        throw new Error('unreadable');
      });
      if (measured.durationS > VOICE_MAX_SECONDS + 0.5) throw new Error('tooLong');
      const stored = await masjidApi.uploadAudio(
        masjidId ?? '',
        file,
        Math.max(0.5, measured.durationS),
        measured.peaks,
      );
      return { stored, url: URL.createObjectURL(file) };
    },
  });

  // The recorded take as a playable URL (revoked when it is replaced or the field goes away).
  const preview = useMemo(
    () => (recorder.recording ? URL.createObjectURL(recorder.recording) : null),
    [recorder.recording],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const attach = (file: Blob) => {
    upload.mutate(file, {
      onSuccess: ({ stored, url }) => {
        recorder.reset();
        onVoice({ key: stored.audioKey, durationS: stored.durationS, peaks: stored.peaks, url });
      },
      onError: (error) => {
        const message =
          error.message === 'unreadable'
            ? t('voice.unreadable')
            : error.message === 'tooLong'
              ? t('voice.tooLong')
              : errorText(error);
        toast.show({ message, tone: 'error' });
      },
    });
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) attach(file);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="voice-note" data-voice-field>
      <div className="flex flex-col gap-1">
        <h2 id="voice-note" className="type-headline text-text">
          {t('voice.title')}
        </h2>
        <p className="type-footnote text-text-secondary">{t('voice.optional')}</p>
      </div>

      {voice ? (
        <div className="flex flex-col gap-3">
          <VoiceNote src={voice.url} durationS={voice.durationS} peaks={voice.peaks} />
          {title ? (
            <TextField
              label={t('voice.voiceTitle')}
              hint={t('voice.voiceTitleHint')}
              value={title.value}
              maxLength={VOICE_TITLE_MAX}
              dir="auto"
              onChange={(event) => {
                title.onChange(event.target.value);
              }}
            />
          ) : null}
          <Button
            variant="outline"
            size="lg"
            fullWidth
            onPress={() => {
              onVoice(null);
            }}
          >
            {t('voice.remove')}
          </Button>
        </div>
      ) : upload.isPending ? (
        <p className="flex min-h-14 items-center gap-3 type-callout text-text-secondary" aria-live="polite">
          <Spinner size={24} />
          {t('voice.uploading')}
        </p>
      ) : (
        <>
          <Checkbox
            checked={rights}
            onChange={setRights}
            label={t('voice.rights')}
            description={t('voice.rightsHint')}
          />
          <input
            ref={input}
            type="file"
            accept={AUDIO_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={choose}
          />
          {recorder.state === 'recording' || recorder.state === 'paused' ? (
            <div className="flex flex-col gap-3" data-recording>
              <p className="type-title2 tabular-nums text-text" dir="ltr" aria-live="off">
                {clock(recorder.seconds)} / {clock(VOICE_MAX_SECONDS)}
              </p>
              <div
                role="meter"
                aria-label={t('voice.level')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(recorder.level * 100)}
                className="h-2 overflow-hidden rounded-full bg-surface-muted"
              >
                <div
                  className="h-full origin-left bg-primary-700 rtl:origin-right"
                  style={{ transform: `scaleX(${String(recorder.level)})` }}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onPress={recorder.state === 'recording' ? recorder.pause : recorder.resume}
                >
                  {recorder.state === 'recording' ? t('voice.pause') : t('voice.resume')}
                </Button>
                <Button size="lg" fullWidth onPress={recorder.stop}>
                  {t('voice.stop')}
                </Button>
              </div>
            </div>
          ) : recorder.state === 'done' && recorder.recording ? (
            <div className="flex flex-col gap-3">
              <VoiceNote src={preview} durationS={Math.max(1, recorder.seconds)} />
              <div className="flex gap-3">
                <Button variant="secondary" size="lg" fullWidth onPress={recorder.reset}>
                  {t('voice.again')}
                </Button>
                <Button
                  size="lg"
                  fullWidth
                  onPress={() => {
                    if (recorder.recording) attach(recorder.recording);
                  }}
                >
                  {t('voice.useThis')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recorder.state === 'denied' ? (
                <p className="type-footnote text-text-secondary" role="status">
                  {t('voice.denied')}
                </p>
              ) : null}
              <Button
                size="lg"
                fullWidth
                disabled={!rights}
                onPress={() => {
                  void recorder.start();
                }}
              >
                {t('voice.record')}
              </Button>
              <Button
                variant="outline"
                size="lg"
                fullWidth
                disabled={!rights}
                onPress={() => {
                  input.current?.click();
                }}
              >
                {t('voice.chooseFile')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
