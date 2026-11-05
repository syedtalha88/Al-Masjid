// What the server needs about a voice note besides the file (07 B14, DECISIONS #126): its length and the 48-value peak
// envelope for the musalli waveform — measured here while the recording is decoded for the admin's own preview.

/** 00 §4.13: at most ten minutes. */
export const VOICE_MAX_SECONDS = 600;
export const VOICE_PEAKS = 48;

/**
 * The peak envelope of `samples`: the loudest |sample| in each of `count` equal slices, scaled so the loudest slice is
 * 255 (silence stays 0).
 *
 * @returns `count` integers 0…255.
 */
export function peaksOf(samples: Float32Array, count = VOICE_PEAKS): number[] {
  const size = Math.max(1, Math.floor(samples.length / count));
  const raw = Array.from({ length: count }, (_, slice) => {
    let peak = 0;
    const end = Math.min(samples.length, (slice + 1) * size);
    for (let index = slice * size; index < end; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      if (value > peak) peak = value;
    }
    return peak;
  });
  const loudest = Math.max(...raw);
  return raw.map((peak) => (loudest === 0 ? 0 : Math.round((peak / loudest) * 255)));
}

/**
 * Decodes a recording (Web Audio) and measures it.
 *
 * @returns whole-ish seconds (3 decimals) and 48 peaks.
 * @throws Error when the browser cannot decode the file (the admin then picks another).
 */
export async function measureRecording(blob: Blob): Promise<{ durationS: number; peaks: number[] }> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return {
      durationS: Math.round(buffer.duration * 1000) / 1000,
      peaks: peaksOf(buffer.getChannelData(0)),
    };
  } finally {
    void context.close();
  }
}

/** The first recording format this browser's MediaRecorder offers (Safari MP4/AAC, Chrome Ogg/Opus or WebM). */
export function recordingType(isSupported: (type: string) => boolean): string | undefined {
  return ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((type) =>
    isSupported(type),
  );
}
