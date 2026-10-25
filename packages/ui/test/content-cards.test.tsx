// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AmeenButton } from '../src/components/AmeenButton.tsx';
import { AnnouncementCard, DuaBox, DuaRequestCard } from '../src/components/ContentCards.tsx';
import { HadithCard } from '../src/components/HadithCard.tsx';
import { ImageViewer } from '../src/components/ImageViewer.tsx';
import { HadithHeroArt } from '../src/illustrations/HadithHeroArt.tsx';
import { renderUi } from './render.tsx';

// T2.11 content components (06 §6, 07 A7–A9, 08 §5.6). Religious text: the 10 §5 placeholders only.
const ARABIC = 'نص تجريبي للعرض فقط';
const TRANSLITERATION = 'Sample transliteration — DEV ONLY';
const TRANSLATION = '“Sample translation text for development. Not a real hadith.”';

/** The text of the element(s) named by `aria-describedby`. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnnouncementCard', () => {
  it('is one button named by its title, described by time, body and tags', async () => {
    const onPress = vi.fn();
    await renderUi(
      <AnnouncementCard
        icon={<span />}
        title="No water supply"
        time="2 hours ago"
        body="Water will not be available from 10 AM to 2 PM."
        tags={[{ label: 'Important', tone: 'danger' }]}
        eventDate="Sat, 26 Sep"
        masjid="Test Masjid Alpha"
        onPress={onPress}
      />,
    );
    const card = screen.getByRole('button', { name: 'No water supply' });
    expect(description(card)).toMatch(/2 hours ago.*Water will not.*Important.*Sat, 26 Sep/);
    expect(card.textContent).toContain('Test Masjid Alpha');
    expect(screen.getByText('Important').className).toContain('bg-danger-bg');
    fireEvent.click(card);
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('DuaBox / DuaRequestCard', () => {
  it('shows Arabic as Arabic (lang/dir on the element, Amiri), with the fallback tag', async () => {
    await renderUi(
      <DuaBox arabic={ARABIC} transliteration={TRANSLITERATION} translation={TRANSLATION} translationTag="English" />,
      { locale: 'ur' },
    );
    const arabic = screen.getByText(ARABIC);
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
    expect(arabic.className).toContain('type-arabic-body');
    expect(screen.getByText('English')).toBeTruthy();
  });

  it('keeps Ameen outside the card button; the janaza row and person line show', async () => {
    const onPress = vi.fn();
    const onSay = vi.fn();
    await renderUi(
      <DuaRequestCard
        icon={<span />}
        tag={{ label: 'Inteqal', tone: 'slate' }}
        time="1 day ago"
        title="Request for Dua"
        message="Please make dua for a brother from our community."
        person="For a brother or sister from our community"
        dua={{ arabic: ARABIC, translation: TRANSLATION }}
        janaza="Janaza: today, 5:30 PM · Test Masjid Alpha"
        footer={
          <AmeenButton said={false} onSay={onSay} label="Ameen" saidLabel="You said Ameen" count="3 said Ameen" />
        }
        onPress={onPress}
      />,
    );
    const card = screen.getByRole('button', { name: 'Request for Dua' });
    const ameen = screen.getByRole('button', { name: 'Ameen' });
    expect(card.contains(ameen)).toBe(false);
    expect(screen.getByText(/Janaza: today/)).toBeTruthy();
    expect(description(card)).toMatch(/For a brother or sister.*Please make dua/);
    fireEvent.click(ameen);
    expect(onSay).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();
  });
});

function AmeenHarness({ onSay }: { readonly onSay: () => void }) {
  const [said, setSaid] = useState(false);
  const [count, setCount] = useState(1203);
  return (
    <AmeenButton
      said={said}
      onSay={() => {
        onSay();
        setSaid(true);
        setCount((value) => value + 1);
      }}
      label="Ameen"
      saidLabel="You said Ameen"
      count={`${count.toLocaleString('en-IN')} said Ameen`}
    />
  );
}

describe('AmeenButton (08 §5.6)', () => {
  it('counts once: the tap pops, ripples, buzzes 15 ms and fills; tapping again does nothing', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const onSay = vi.fn();
    await renderUi(<AmeenHarness onSay={onSay} />);
    const button = screen.getByRole('button', { name: 'Ameen' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 5 });
    fireEvent.click(button);
    expect(onSay).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(button.hasAttribute('data-ripple')).toBe(true);
    expect(button.style.getPropertyValue('--mc-ripple-x')).toMatch(/px$/);
    const filled = screen.getByRole('button', { name: 'You said Ameen' });
    expect(filled.getAttribute('aria-pressed')).toBe('true');
    expect(filled.className).toContain('bg-primary-700');
    expect(screen.getAllByText('1,204 said Ameen').length).toBeGreaterThan(0);
    fireEvent.click(filled);
    expect(onSay).toHaveBeenCalledOnce();
  });

  it('reduced motion: no ripple and no pop — the state still changes', async () => {
    const onSay = vi.fn();
    await renderUi(<AmeenHarness onSay={onSay} />, { reduced: true });
    const button = screen.getByRole('button', { name: 'Ameen' });
    fireEvent.click(button);
    expect(button.hasAttribute('data-ripple')).toBe(false);
    expect(onSay).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'You said Ameen' })).toBeTruthy();
  });
});

describe('HadithCard', () => {
  const base = {
    arabic: ARABIC,
    transliteration: TRANSLITERATION,
    translation: TRANSLATION,
    reference: 'DEV-SAMPLE-001',
    date: '26 Sep 2026',
    saveLabel: 'Save',
    savedLabel: 'Saved',
    shareLabel: 'Share',
    readFullLabel: 'Read Full',
  } as const;

  it('hero: picture, date pill, today pill, note; bookmark toggles; Share and Read Full', async () => {
    const onToggleSave = vi.fn();
    const onShare = vi.fn();
    const onReadFull = vi.fn();
    await renderUi(
      <HadithCard
        {...base}
        variant="hero"
        italic
        todayLabel="Today’s Hadith"
        note={{ label: 'Note from masjid', text: 'Sample note — dev only.' }}
        saved={false}
        onToggleSave={onToggleSave}
        onShare={onShare}
        onReadFull={onReadFull}
        art={<HadithHeroArt />}
      />,
    );
    expect(screen.getByText('Today’s Hadith')).toBeTruthy();
    expect(screen.getByText('26 Sep 2026')).toBeTruthy();
    expect(screen.getByText(ARABIC).className).toContain('type-arabic-hero');
    expect(screen.getByText(TRANSLATION).className).toContain('italic');
    expect(screen.getByText('Note from masjid')).toBeTruthy();
    const bookmark = screen.getByRole('button', { name: 'Save' });
    expect(bookmark.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(bookmark);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read Full' }));
    expect([onToggleSave, onShare, onReadFull].every((fn) => fn.mock.calls.length === 1)).toBe(true);
    expect(document.querySelector('svg[aria-hidden]')).toBeTruthy();
  });

  it('regular: saved bookmark, upright translation, date at the end', async () => {
    await renderUi(
      <HadithCard
        {...base}
        saved
        onToggleSave={() => undefined}
        onShare={() => undefined}
        onReadFull={() => undefined}
      />,
      { locale: 'hi' },
    );
    expect(screen.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(TRANSLATION).className).not.toContain('italic');
    expect(screen.getByText(ARABIC).className).toContain('type-arabic-body');
    expect(screen.queryByText('Today’s Hadith')).toBeNull();
  });
});

describe('ImageViewer', () => {
  it('opens as a modal named by the photo and closes (zoom: zoom.test.ts + e2e — jsdom has no layout)', async () => {
    const onClose = vi.fn();
    const { rerender } = await renderUi(
      <ImageViewer open src="/photo.webp" alt="Notice photo" closeLabel="Close photo" onClose={onClose} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Notice photo' });
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('img', { name: 'Notice photo' }).getAttribute('src')).toBe('/photo.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Close photo' }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <ImageViewer open={false} src="/photo.webp" alt="Notice photo" closeLabel="Close photo" onClose={onClose} />,
    );
  });

  it('without a photo URL it still has an accessible image (the ThumbHash only)', async () => {
    await renderUi(
      <ImageViewer open src={null} alt="Notice photo" closeLabel="Close photo" onClose={() => undefined} />,
    );
    expect(screen.getAllByRole('img', { name: 'Notice photo' }).length).toBe(1);
  });
});
