// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hiddenBannerY } from '../src/components/Feedback.tsx';
import {
  Image,
  InstallPrompt,
  IosInstallGuide,
  OfflineBanner,
  ToastProvider,
  UpdateAvailableToast,
  useInstallPrompt,
  useOnlineStatus,
} from '../src/components/index.ts';
import { type NavigatorApi, NavigatorContext, ScreenContext, type ScreenInfo } from '../src/navigation/context.ts';
import { Screen } from '../src/navigation/Screen.tsx';
import { ScanFab } from '../src/navigation/TabBar.tsx';
import { renderUi } from './render.tsx';

// T0.10 component tests (06 §6, 08 §4, §5.4, §5.10): NavBar/Screen, Image, feedback and install surfaces.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const back = vi.fn();
const navigator: NavigatorApi = {
  activeTab: 'home',
  push: vi.fn(),
  back,
  selectTab: vi.fn(),
  presentModal: vi.fn(),
  preload: vi.fn(),
};

function InScreen({ depth = 1, children }: { readonly depth?: number; readonly children: ReactNode }) {
  const info: ScreenInfo = {
    entry: { key: 'k', href: '/', pathname: '/' },
    tab: 'home',
    depth,
    isTop: true,
    params: {},
    search: {},
    isModal: false,
  };
  return (
    <NavigatorContext value={navigator}>
      <ScreenContext value={info}>{children}</ScreenContext>
    </NavigatorContext>
  );
}

describe('Screen + NavBar (08 §4)', () => {
  it('inline: the bar holds the h1 and subtitle; back shows on pushed screens', async () => {
    await renderUi(
      <InScreen depth={2}>
        <Screen title="Announcements" subtitle="Test Masjid Alpha">
          <p>Body</p>
        </Screen>
      </InScreen>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Announcements' });
    expect(heading.hasAttribute('data-screen-title')).toBe(true);
    expect(screen.getByText('Test Masjid Alpha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }), { detail: 0 });
    expect(back).toHaveBeenCalled();
  });

  it('large: the h1 is the large title in the content; the inline copy is hidden and fades in on scroll', async () => {
    const { container } = await renderUi(
      <InScreen>
        <Screen variant="large" title="My Masjids" lead="Stay connected">
          <p>Body</p>
        </Screen>
      </InScreen>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'My Masjids' });
    const scroller = container.querySelector<HTMLElement>('[data-screen-scroll]');
    expect(scroller?.contains(heading)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    const inline = container.querySelector<HTMLElement>('header [aria-hidden="true"]');
    expect(inline?.textContent).toBe('My Masjids');
    expect(inline?.style.opacity).toBe('0');
    if (!scroller) throw new Error('no scroller');
    scroller.scrollTop = 60;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => {
      expect(inline?.style.opacity).toBe('1');
    });
    expect(heading.parentElement?.style.opacity).toBe('0');
    expect(container.querySelector<HTMLElement>('header')?.style.getPropertyValue('--mc-bar-progress')).toBe('1');
  });

  it('ScanFab is a named button that presses', async () => {
    const onPress = vi.fn();
    await renderUi(<ScanFab label="Scan QR code" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan QR code' }), { detail: 0 });
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Image (08 §5.4)', () => {
  it('reserves the box, fades the photo in on load, keeps the placeholder on error', async () => {
    const { container, rerender } = await renderUi(
      <Image src="/a.jpg" alt="Masjid front" thumbhash="IQgSLYZ6iHePh4h1eFeHh4dwgwg3" ratio="3/4" />,
    );
    expect(container.firstElementChild?.className).toContain('aspect-[3/4]');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    const image = screen.getByRole('img', { name: 'Masjid front' });
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.className).toContain('opacity-0');
    fireEvent.load(image);
    expect(image.className).toContain('opacity-100');
    rerender(<Image src="/b.jpg" alt="Masjid front" thumbhash="IQgSLYZ6iHePh4h1eFeHh4dwgwg3" ratio="3/4" />);
    expect(screen.getByRole('img', { name: 'Masjid front' }).className).toContain('opacity-0');
    fireEvent.error(screen.getByRole('img', { name: 'Masjid front' }));
    expect(screen.queryByRole('img', { name: 'Masjid front' })).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('priority images load eagerly; a bad thumbhash does not throw', async () => {
    await renderUi(<Image src="/hero.jpg" alt="" thumbhash="!!not-base64" priority />);
    const image = document.querySelector('img');
    expect(image?.getAttribute('loading')).toBe('eager');
    expect(image?.getAttribute('fetchpriority')).toBe('high');
  });
});

describe('offline + update surfaces (08 §5.10)', () => {
  it('useOnlineStatus follows online/offline events', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);
    vi.restoreAllMocks();
  });

  it('hidden banner offset is a percentage of its height that clears the viewport (V-19)', () => {
    // The driver renders y as translateY(<y>%): −100 % is exactly the banner's height, plus an 8 px margin.
    expect(hiddenBannerY(40)).toBe(-120);
    expect(hiddenBannerY(80)).toBe(-110);
    expect(hiddenBannerY(0)).toBe(-110);
    for (const height of [20, 34, 52, 96]) expect((hiddenBannerY(height) / 100) * height).toBeCloseTo(-(height + 8));
  });

  it('offline banner announces only while offline', async () => {
    const { rerender } = await renderUi(<OfflineBanner offline={false} />);
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('');
    rerender(<OfflineBanner offline />);
    expect(screen.getByRole('status').textContent).toBe('You’re offline — showing saved information');
  });

  it('update toast is persistent and its action refreshes', async () => {
    const onRefresh = vi.fn();
    const { rerender } = await renderUi(
      <ToastProvider>
        <UpdateAvailableToast available={false} onRefresh={onRefresh} />
      </ToastProvider>,
    );
    expect(screen.queryByText('A new version of the app is ready', { selector: 'p' })).toBeNull();
    rerender(
      <ToastProvider>
        <UpdateAvailableToast available onRefresh={onRefresh} />
      </ToastProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByText('A new version of the app is ready', { selector: 'p' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }), { detail: 0 });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('install (07 Onboarding step 6)', () => {
  it('useInstallPrompt captures a valid beforeinstallprompt and installs', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    // A bogus event (no prompt()) is ignored.
    act(() => {
      window.dispatchEvent(new Event('beforeinstallprompt'));
    });
    expect(result.current.canInstall).toBe(false);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canInstall).toBe(true);
    let accepted = false;
    await act(async () => {
      accepted = await result.current.install();
    });
    expect(accepted).toBe(true);
    expect(event.prompt).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(false);
  });

  it('install card names the app and offers install / not now', async () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    await renderUi(<InstallPrompt appName="Masjid Connect" onInstall={onInstall} onDismiss={onDismiss} />);
    expect(screen.getByRole('heading', { name: 'Install Masjid Connect' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }), { detail: 0 });
    expect(onInstall).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('iOS guide: three steps highlighted in a loop; static with reduced motion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = await renderUi(<IosInstallGuide appName="Masjid Connect" onDismiss={vi.fn()} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]?.getAttribute('aria-current')).toBe('step');
    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(steps[1]?.getAttribute('aria-current')).toBe('step');
    unmount();
    await renderUi(<IosInstallGuide appName="Masjid Connect" onDismiss={vi.fn()} />, { reduced: true });
    expect(screen.getAllByRole('listitem').every((step) => !step.hasAttribute('aria-current'))).toBe(true);
    expect(screen.getByText('Open Masjid Connect from your Home Screen')).toBeTruthy();
  });
});

describe('TabBar badge (06 §6)', () => {
  it('shows the unseen count on Updates and includes it in the tab name', async () => {
    const { TabBar } = await import('../src/navigation/TabBar.tsx');
    const { UpdatesIcon, HomeIcon } = await import('../src/navigation/icons.tsx');
    await renderUi(
      <TabBar
        api={navigator}
        label="Main"
        start={[
          { id: 'home', label: 'Home', Icon: HomeIcon },
          { id: 'masjids', label: 'My Masjids', Icon: HomeIcon },
        ]}
        end={[
          { id: 'updates', label: 'Updates', Icon: UpdatesIcon, badge: 3 },
          { id: 'settings', label: 'Settings', Icon: HomeIcon },
        ]}
        scan={{ label: 'Scan QR code', href: '/scan' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Updates, 3 new' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
  });
});
