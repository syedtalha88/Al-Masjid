// @vitest-environment jsdom
import type { AdminMasjidProfile } from '@mc/shared/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as MasjidApi from '../../home/api/masjid-api.ts';
import { masjidApi } from '../../home/api/masjid-api.ts';
import { useChangeRequest, useHijriOffset, useMasjidPhoto, useProfile } from '../hooks/use-profile.ts';

vi.mock('../../home/api/masjid-api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof MasjidApi>()),
  masjidApi: { profile: vi.fn(), setHijriOffset: vi.fn(), uploadMasjidPhoto: vi.fn(), requestChange: vi.fn() },
}));

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const PROFILE: AdminMasjidProfile = {
  id: 'm1',
  name: 'Test Masjid',
  nameI18n: {},
  area: 'Test Area',
  city: 'Hyderabad',
  state: 'Telangana',
  address: '',
  hijriOffset: null,
  globalHijriOffset: 0,
};

afterEach(() => {
  vi.resetAllMocks();
});

// 07 B13 (T3.10): the profile read; the Hijri adjustment and a new photo answer the new profile (it replaces the
// cached one); "Request change".
describe('profile hooks', () => {
  it('loads the profile; nothing without a masjid', async () => {
    vi.mocked(masjidApi.profile).mockResolvedValue(PROFILE);
    const idle = renderHook(() => useProfile(undefined), { wrapper: wrapper(client()) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHook(() => useProfile('m1'), { wrapper: wrapper(client()) });
    await waitFor(() => {
      expect(result.current.data?.name).toBe('Test Masjid');
    });
  });

  it('the Hijri adjustment and a photo replace the cached profile and refresh the masjid', async () => {
    vi.mocked(masjidApi.setHijriOffset).mockResolvedValue({ ...PROFILE, hijriOffset: 1 });
    vi.mocked(masjidApi.uploadMasjidPhoto).mockResolvedValue({ ...PROFILE, photo: { key: 'm/k', thumbhash: 'AAAA' } });
    const queries = client();
    const invalidate = vi.spyOn(queries, 'invalidateQueries');
    const { result } = renderHook(() => ({ hijri: useHijriOffset('m1'), photo: useMasjidPhoto('m1') }), {
      wrapper: wrapper(queries),
    });
    await act(() => result.current.hijri.mutateAsync(1));
    expect(masjidApi.setHijriOffset).toHaveBeenCalledWith('m1', 1);
    expect(queries.getQueryData<AdminMasjidProfile>(['masjid', 'm1', 'profile'])?.hijriOffset).toBe(1);
    const file = new Blob(['x'], { type: 'image/png' });
    await act(() => result.current.photo.mutateAsync(file));
    expect(masjidApi.uploadMasjidPhoto).toHaveBeenCalledWith('m1', file);
    expect(queries.getQueryData<AdminMasjidProfile>(['masjid', 'm1', 'profile'])?.photo?.key).toBe('m/k');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masjid', 'm1'] });
  });

  it('sends a change request', async () => {
    vi.mocked(masjidApi.requestChange).mockResolvedValue(undefined);
    const { result } = renderHook(() => useChangeRequest('m1'), { wrapper: wrapper(client()) });
    await act(() => result.current.mutateAsync('Test note'));
    expect(masjidApi.requestChange).toHaveBeenCalledWith('m1', 'Test note');
  });
});
