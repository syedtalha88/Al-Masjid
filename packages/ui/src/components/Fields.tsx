import { useTranslation } from '@mc/i18n/react';
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { SearchIcon, XIcon } from '../icons/glyphs.tsx';
import { Pressable } from '../motion/Pressable.tsx';

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  // Pass-through from the public field props, so `undefined` is accepted explicitly.
  readonly hideLabel?: boolean | undefined;
  readonly optional?: boolean | undefined;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  /** Extra line after the hint (TextArea counter). */
  readonly aside?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

const hintId = (id: string) => `${id}-hint`;
const errorId = (id: string) => `${id}-error`;
const asideId = (id: string) => `${id}-aside`;

/** `aria-describedby` for a field: hint, error and counter, when present. */
function describedBy(id: string, hint: unknown, error: unknown, aside: unknown): string | undefined {
  const ids = [hint ? hintId(id) : null, error ? errorId(id) : null, aside ? asideId(id) : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Shakes `ref` when `error` appears or changes (08 §5.10); the message itself is announced by `role="alert"`.
 * The CSS `shake` utility does nothing with reduced motion.
 */
function useShake(ref: RefObject<HTMLElement | null>, error: string | undefined) {
  const previous = useRef(error);
  useEffect(() => {
    const node = ref.current;
    if (!node || !error || error === previous.current) {
      previous.current = error;
      return;
    }
    previous.current = error;
    node.classList.remove('shake');
    // Restart the animation when the same field errors twice in a row (a call, so no minifier drops it).
    node.getBoundingClientRect();
    node.classList.add('shake');
    const done = () => {
      node.classList.remove('shake');
    };
    node.addEventListener('animationend', done, { once: true });
    return () => {
      node.removeEventListener('animationend', done);
    };
  }, [error, ref]);
}

function FieldShell({ id, label, hideLabel, optional, hint, error, aside, className, children }: FieldShellProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'flex items-baseline gap-2 type-subhead-strong text-text'}>
        {label}
        {optional ? <span className="type-footnote font-normal text-text-tertiary">{t('ui.optional')}</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId(id)} className="type-footnote text-text-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId(id)} role="alert" className="type-footnote text-danger">
          {error}
        </p>
      ) : null}
      {aside}
    </div>
  );
}

const INPUT =
  'w-full min-w-0 rounded-sm border bg-surface px-4 type-body text-text transition-state placeholder:text-text-tertiary focus:border-primary-600 focus:outline-2 focus:outline-offset-0 focus:outline-focus disabled:opacity-40';

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'className' | 'size'> {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly optional?: boolean;
  readonly hint?: ReactNode;
  /** Error message (translated); marks the field invalid, shakes it and announces the message. */
  readonly error?: string | undefined;
  readonly className?: string;
}

/** Text input (06 §6): visible label above, 48 px (56 admin) field, hint or error below. */
export function TextField({ label, hideLabel, optional, hint, error, className, ...rest }: TextFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useShake(input, error);
  return (
    <FieldShell
      id={id}
      label={label}
      hideLabel={hideLabel}
      optional={optional}
      hint={hint}
      error={error}
      className={className}
    >
      <input
        {...rest}
        ref={input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint && !error, error, null)}
        className={`${INPUT} min-h-(--mc-control-md) ${error ? 'border-danger' : 'border-border'}`}
      />
    </FieldShell>
  );
}

export interface TextAreaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'id' | 'className'> {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly optional?: boolean;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  /** Character limit: shown as a live "120/500" counter (Latin digits) and enforced by `maxLength`. */
  readonly maxLength?: number;
  readonly className?: string;
}

/** Multi-line text with an optional live character counter (06 §6). */
export function TextArea({
  label,
  hideLabel,
  optional,
  hint,
  error,
  maxLength,
  className,
  value,
  defaultValue,
  onChange,
  rows = 4,
  ...rest
}: TextAreaProps) {
  const { t } = useTranslation();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? '').length);
  const length = typeof value === 'string' ? value.length : uncontrolledLength;
  useShake(area, error);
  const counter =
    maxLength === undefined ? null : (
      <p
        id={asideId(id)}
        className={`self-end type-caption tabular-nums ${length >= maxLength ? 'text-danger' : 'text-text-tertiary'}`}
      >
        <span aria-hidden>
          <bdi>{`${String(length)}/${String(maxLength)}`}</bdi>
        </span>
        <span className="sr-only">{t('ui.characterCount', { count: length, max: maxLength })}</span>
      </p>
    );
  return (
    <FieldShell
      id={id}
      label={label}
      hideLabel={hideLabel}
      optional={optional}
      hint={hint}
      error={error}
      aside={counter}
      className={className}
    >
      <textarea
        {...rest}
        ref={area}
        id={id}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        onChange={(event) => {
          setUncontrolledLength(event.currentTarget.value.length);
          onChange?.(event);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint && !error, error, counter)}
        className={`${INPUT} resize-none py-3 ${error ? 'border-danger' : 'border-border'}`}
      />
    </FieldShell>
  );
}

export interface SearchFieldProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'id' | 'className' | 'type' | 'value' | 'onChange' | 'size'
> {
  /** Accessible name (visually hidden; the placeholder is not a label). */
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
}

/** Search input (06 §6): pill, search glyph, clear button when not empty; `enterkeyhint="search"`. */
export function SearchField({ label, value, onChange, className, ...rest }: SearchFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`relative flex items-center ${className ?? ''}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon size={20} className="pointer-events-none absolute start-4 text-text-tertiary" />
      <input
        {...rest}
        ref={input}
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        className="min-h-(--mc-hit) w-full rounded-full bg-surface-muted ps-11 pe-11 type-body text-text placeholder:text-text-tertiary focus:outline-2 focus:outline-offset-0 focus:outline-focus [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <Pressable
          aria-label={t('ui.clearSearch')}
          onPress={() => {
            onChange('');
            input.current?.focus();
          }}
          className="absolute end-0 inline-flex size-(--mc-hit) items-center justify-center rounded-full text-text-tertiary"
        >
          <XIcon size={18} />
        </Pressable>
      ) : null}
    </div>
  );
}
