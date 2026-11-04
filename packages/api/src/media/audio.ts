// Voice notes (01 §5.5 Audio, 04 R14, DECISIONS #104, PHASE_03 T3.13): every admin recording is identified by its
// magic bytes (never the claimed name or type) — Ogg (Opus), WebM, MP4 / M4A / AAC / 3GP, MP3, WAV — at most 25 MB and
// 10 minutes. The admin's browser measures the length and the 48-value peak envelope while it decodes the recording
// for its own preview (Web Audio); the server bounds both, and where the storage measures the duration itself
// (Cloudinary) that value decides. Cloudinary re-encodes to one AAC rendition, so no original is ever served.

/** 01 §5.5: recordings up to 25 MB. */
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
/** 00 §4.13 / 04 R14: at most ten minutes. */
export const AUDIO_MAX_SECONDS = 600;
/** The waveform: 48 peaks, 0…255 (decorative — A18). */
export const AUDIO_PEAKS = 48;

/** What an accepted recording is, by its first bytes. */
export type SniffedAudio = 'ogg' | 'webm' | 'mp4' | 'mp3' | 'wav' | 'aac';

/** The MIME type the storage is told (the bytes decide what it is). */
export const AUDIO_MIME: Readonly<Record<SniffedAudio, string>> = {
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
};

const ascii = (bytes: Buffer, start: number, end: number) => bytes.subarray(start, end).toString('latin1');

/** ISO-BMFF brands of audio files (M4A / MP4 audio as browsers and phones record it, 3GP voice memos). */
const MP4_BRANDS = new Set([
  'M4A ',
  'M4B ',
  'mp41',
  'mp42',
  'isom',
  'iso2',
  'iso5',
  'iso6',
  'dash',
  '3gp4',
  '3gp5',
  '3gp6',
  '3g2a',
  'qt  ',
]);

/**
 * The audio container of `bytes` by magic number.
 *
 * @returns the type, or `null` for anything else (images, documents, executables, text…).
 */
export function sniffAudio(bytes: Buffer): SniffedAudio | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (ascii(bytes, 4, 8) === 'ftyp' && MP4_BRANDS.has(ascii(bytes, 8, 12))) return 'mp4';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') return 'wav';
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  if (first === 0xff && (second & 0xf6) === 0xf0) return 'aac'; // ADTS: sync word 0xFFF, layer 00
  if (first === 0xff && (second & 0xe0) === 0xe0) return 'mp3'; // MPEG audio frame sync
  return null;
}

/** Why a recording is refused (the route maps each to one friendly message). */
export class AudioRejected extends Error {
  readonly reason: 'not_audio' | 'too_long';
  constructor(reason: AudioRejected['reason']) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * The length to keep: the storage's own measurement when it has one, else the browser's — refused above ten minutes.
 *
 * @param declared - the admin browser's measurement (seconds, already bounded by the contract).
 * @param measured - the storage's (Cloudinary) measurement, when it returned one.
 * @returns whole seconds, at least 1.
 * @throws AudioRejected `too_long`.
 */
export function keptDuration(declared: number, measured: number | undefined): number {
  const seconds = measured !== undefined && Number.isFinite(measured) && measured > 0 ? measured : declared;
  if (seconds > AUDIO_MAX_SECONDS + 0.5) throw new AudioRejected('too_long');
  return Math.min(AUDIO_MAX_SECONDS, Math.max(1, Math.round(seconds)));
}
