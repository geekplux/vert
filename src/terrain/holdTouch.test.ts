import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdVerticalTouch, TOUCH_SLOP } from './holdTouch';

/**
 * A wrapper with the filter and a canvas inside; `seen` lists the moves that reach the canvas and
 * the document (where three.js's OrbitControls listens while a pointer is down).
 */
let wrapper: HTMLDivElement;
let canvas: HTMLCanvasElement;
let seen: { canvas: string[]; document: string[] };
let remove: () => void;
const onCanvas = (e: Event) => seen.canvas.push(label(e));
const onDocument = (e: Event) => seen.document.push(label(e));
const label = (e: Event) => {
  const p = e as PointerEvent;
  return `${p.type} ${String(p.pointerId)} ${String(p.clientX)},${String(p.clientY)}`;
};

beforeEach(() => {
  wrapper = document.createElement('div');
  canvas = document.createElement('canvas');
  wrapper.append(canvas);
  document.body.append(wrapper);
  seen = { canvas: [], document: [] };
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    canvas.addEventListener(type, onCanvas);
    document.addEventListener(type, onDocument);
  }
  remove = holdVerticalTouch(wrapper);
});
afterEach(() => {
  remove();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    document.removeEventListener(type, onDocument);
  }
  wrapper.remove();
});

const send = (
  type: string,
  x: number,
  y: number,
  { id = 1, pointerType = 'touch' }: { id?: number; pointerType?: string } = {},
) => {
  canvas.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerId: id, pointerType, clientX: x, clientY: y }),
  );
};
const moves = (list: string[]) => list.filter((s) => s.startsWith('pointermove'));

describe('holdVerticalTouch', () => {
  it('holds a vertical swipe’s moves back from the canvas and the document; down and cancel pass', () => {
    send('pointerdown', 100, 100);
    send('pointermove', 102, 79); // Chromium's ~21–25 px before it cancels
    send('pointermove', 103, 55);
    send('pointercancel', 103, 55);
    expect(moves(seen.canvas)).toEqual([]);
    expect(moves(seen.document)).toEqual([]);
    expect(seen.canvas).toEqual(['pointerdown 1 100,100', 'pointercancel 1 103,55']);
    expect(seen.document).toEqual(['pointerdown 1 100,100', 'pointercancel 1 103,55']);
  });

  it('passes a sideways drag once it is past the slop, and keeps passing it', () => {
    send('pointerdown', 100, 100);
    send('pointermove', 100 + TOUCH_SLOP, 101); // within the slop: held
    send('pointermove', 100 + TOUCH_SLOP + 1, 102); // across, more than down: passes
    send('pointermove', 130, 140); // decided: passes even going down
    send('pointerup', 130, 140);
    expect(moves(seen.canvas)).toEqual(['pointermove 1 109,102', 'pointermove 1 130,140']);
    expect(moves(seen.document)).toEqual(moves(seen.canvas));
    expect(seen.canvas.at(-1)).toBe('pointerup 1 130,140');
  });

  it('keeps holding a swipe that went down first, even if it then turns sideways', () => {
    send('pointerdown', 100, 100);
    send('pointermove', 101, 120);
    send('pointermove', 160, 122);
    send('pointerup', 160, 122);
    expect(moves(seen.canvas)).toEqual([]);
    // The next gesture starts afresh.
    send('pointerdown', 100, 100, { id: 2 });
    send('pointermove', 120, 101, { id: 2 });
    expect(moves(seen.canvas)).toEqual(['pointermove 2 120,101']);
  });

  it('never holds two fingers (a pinch), nor a mouse or a pen', () => {
    send('pointerdown', 100, 100, { id: 1 });
    send('pointerdown', 140, 100, { id: 2 });
    send('pointermove', 100, 90, { id: 1 });
    send('pointermove', 140, 112, { id: 2 });
    expect(moves(seen.canvas)).toEqual(['pointermove 1 100,90', 'pointermove 2 140,112']);
    send('pointerup', 100, 90, { id: 1 });
    send('pointerup', 140, 112, { id: 2 });
    seen.canvas = [];
    for (const pointerType of ['mouse', 'pen']) {
      send('pointerdown', 10, 10, { id: 5, pointerType });
      send('pointermove', 11, 60, { id: 5, pointerType });
      send('pointerup', 11, 60, { id: 5, pointerType });
    }
    expect(moves(seen.canvas)).toEqual(['pointermove 5 11,60', 'pointermove 5 11,60']);
  });

  it('removes itself', () => {
    remove();
    send('pointerdown', 100, 100);
    send('pointermove', 100, 140);
    expect(moves(seen.canvas)).toEqual(['pointermove 1 100,140']);
  });
});
