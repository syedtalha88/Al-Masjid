// `node scripts/generate-audio-fixtures.ts` — the voice-note test fixtures (PHASE_03 T3.13 "Safari MP4 and Chrome Opus
// accepted (fixtures generated, never real recitation)"): Chromium's MediaRecorder records two seconds of a
// generated 440 Hz tone: WebM/Opus (what Chrome records) and MP4/AAC (what Safari records — recorded by Chromium too:
// Playwright's WebKit has no Web Audio on Windows, and the container and codec are what the upload checks). Written to
// packages/api/test/fixtures/; re-run only when a browser's recording format changes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('../packages/api/test/fixtures/', import.meta.url));

/** Records the tone in the page; returns the recording's MIME type and bytes. */
async function record(mimeType: string): Promise<{ type: string; bytes: Buffer }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>fixture</title>');
    const { type, data } = await page.evaluate(async (wanted) => {
      const context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator();
      tone.frequency.value = 440;
      const gain = context.createGain();
      gain.gain.value = 0.2;
      const destination = context.createMediaStreamDestination();
      tone.connect(gain).connect(destination);
      tone.start();
      const recorder = new MediaRecorder(destination.stream, { mimeType: wanted });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      recorder.stop();
      await stopped;
      tone.stop();
      await context.close();
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { type: recorder.mimeType, data: btoa(binary) };
    }, mimeType);
    return { type, bytes: Buffer.from(data, 'base64') };
  } finally {
    await browser.close();
  }
}

mkdirSync(OUT, { recursive: true });
for (const [name, mimeType, extension] of [
  ['chrome-opus', 'audio/webm;codecs=opus', 'webm'],
  ['safari-aac', 'audio/mp4;codecs=mp4a.40.2', 'm4a'],
] as const) {
  const { type, bytes } = await record(mimeType);
  if (bytes.length < 1000) throw new Error(`${name}: recording too small (${String(bytes.length)} bytes, ${type})`);
  writeFileSync(`${OUT}${name}.${extension}`, bytes);
  process.stdout.write(`${name}.${extension}: ${type}, ${String(bytes.length)} bytes\n`);
}
