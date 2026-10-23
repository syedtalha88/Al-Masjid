// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MasjidListItem } from '../src/components/MasjidListItem.tsx';
import { ReorderList } from '../src/components/ReorderList.tsx';
import { renderUi } from './render.tsx';

// T2.7 My Masjids components (06 §6, 07 A3): the list row and the drag/keyboard reorder list.

afterEach(cleanup);

describe('MasjidListItem', () => {
  it('shows the next jamaat, the unseen count (9+) and opens the masjid', async () => {
    const onPress = vi.fn();
    await renderUi(
      <MasjidListItem
        name="Test Masjid Alpha"
        place="Area, City"
        prayer="asr"
        countdown={{ kind: 'left', hours: 0, minutes: 48 }}
        unseen={12}
        highlighted
        onPress={onPress}
      />,
    );
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('Asr');
    expect(row.textContent).toContain('9+');
    expect(row.textContent).toContain('new updates');
    expect(row.className).toContain('bg-mint-50');
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalled();
  });

  it('no jamaat → the empty text; no unseen → no circle; a photo thumb', async () => {
    await renderUi(
      <MasjidListItem
        name="M"
        place="P"
        prayer={null}
        countdown={null}
        emptyText="No jamaat times set"
        unseen={0}
        photo={{ src: 'https://media.example/p' }}
        onPress={vi.fn()}
      />,
    );
    expect(screen.getByText('No jamaat times set')).toBeTruthy();
    expect(document.querySelector('[data-unseen]')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://media.example/p');
  });
});

function Demo() {
  const [items, setItems] = useState(['a', 'b', 'c']);
  return (
    <ReorderList
      label="List"
      items={items}
      keyOf={(item) => item}
      handleLabel={(item) => `Reorder ${item}`}
      renderItem={(item) => <span>{item}</span>}
      onReorder={(from, to) => {
        setItems((current) => {
          const next = [...current];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) next.splice(to, 0, moved);
          return next;
        });
      }}
    />
  );
}

const order = () => screen.getAllByRole('listitem').map((row) => row.textContent);

describe('ReorderList', () => {
  it('arrow keys on a handle move its row and keep focus on it', async () => {
    await renderUi(<Demo />);
    const handle = screen.getByRole('button', { name: 'Reorder a' });
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(order()).toEqual(['b', 'a', 'c']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Reorder a');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder b' }), { key: 'ArrowUp' }); // already first
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder c' }), { key: 'Enter' }); // not a move
    expect(order()).toEqual(['b', 'a', 'c']);
  });

  it('dragging a handle past rows moves it there; a small drag changes nothing', async () => {
    await renderUi(<Demo />);
    const rows = screen.getAllByRole('listitem');
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 100, 300, 90);
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const handle = screen.getByRole('button', { name: 'Reorder a' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 45 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 60 });
    expect(rows[0]?.style.transform).toBe('translateY(15px)');
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 60 });
    expect(order()).toEqual(['a', 'b', 'c']);
    // Down past both others.
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientY: 45 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 260 });
    expect(rows[1]?.style.transform).toBe('translateY(-90px)');
    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 260 });
    expect(order()).toEqual(['b', 'c', 'a']);
    vi.restoreAllMocks();
  });
});
