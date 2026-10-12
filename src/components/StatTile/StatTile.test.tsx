import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { FIT_TOLERANCE_PX, StatGrid, fitScale } from './StatGrid';
import { StatTile } from './StatTile';

// Test-only formatters; the app's shared formatters arrive in src/lib in a later phase.
const oneDecimal = (value: number) => value.toFixed(1);
const signedGrouped = (value: number) => `+${value.toLocaleString('en-US')}`;
const hms = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function renderFourStats() {
  return render(
    <StatGrid>
      <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
      <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
      <StatTile label="Moving time" value={11560} format={hms} />
      <StatTile label="High point" value={820} unit="m" />
    </StatGrid>,
  );
}

/** The `<dd>` that follows the `<dt>` with this label. */
function definitionFor(label: string): HTMLElement {
  const terms = screen.getAllByRole('term');
  const definitions = screen.getAllByRole('definition');
  const index = terms.findIndex((term) => term.textContent === label);
  const definition = definitions[index];
  if (index < 0 || !definition) throw new Error(`No stat labelled ${label}`);
  return definition;
}

describe('StatTile', () => {
  it('renders label, value and unit as a term and its definition', () => {
    render(
      <StatGrid>
        <StatTile label="High point" value={820} unit="m" />
      </StatGrid>,
    );
    expect(screen.getByRole('term')).toHaveProperty('textContent', 'High point');
    const definition = screen.getByRole('definition');
    expect(definition.textContent).toBe('820 m');
    expect(definition.querySelector('span')?.textContent).toBe(' m');
  });

  it('groups digits en-US by default', () => {
    render(
      <StatGrid>
        <StatTile label="Vert" value={1070} unit="m" />
      </StatGrid>,
    );
    expect(screen.getByRole('definition').textContent).toBe('1,070 m');
  });

  it('uses a custom format', () => {
    renderFourStats();
    expect(definitionFor('Distance').textContent).toBe('21.4 km');
    expect(definitionFor('Vert').textContent).toBe('+1,070 m');
    expect(definitionFor('Moving time').textContent).toBe('3:12:40');
  });

  it('renders no unit element when unit is omitted', () => {
    renderFourStats();
    const definition = definitionFor('Moving time');
    expect(definition.textContent).toBe('3:12:40');
    expect(definition.querySelector('span')).toBeNull();
  });

  it('reflects emphasis on the tile', () => {
    renderFourStats();
    expect(definitionFor('Vert').parentElement?.dataset.emphasis).toBe('true');
    expect(definitionFor('Distance').parentElement?.dataset.emphasis).toBe('false');
    // The unit sits inside the emphasised tile, so the --route-text unit rule reaches it.
    const unit = definitionFor('Vert').querySelector('span');
    expect(unit?.textContent).toBe(' m');
    expect(unit?.closest('[data-emphasis="true"]')).toBe(definitionFor('Vert').parentElement);
  });

  it('pairs every term with a definition inside one description list', () => {
    const { container } = renderFourStats();
    const list = container.querySelector('dl');
    expect(list).not.toBeNull();
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Distance',
      'Vert',
      'Moving time',
      'High point',
    ]);
    expect(screen.getAllByRole('definition')).toHaveLength(4);
    for (const term of screen.getAllByRole('term')) {
      expect(list?.contains(term)).toBe(true);
    }
  });

  it('has no axe violations', async () => {
    const { container } = renderFourStats();
    await expectNoAxeViolations(container);
  });
});

describe('fitScale', () => {
  it('is 1 when the value fits, within a pixel of rounding', () => {
    expect(fitScale(105.8, 77.5)).toBe(1);
    expect(fitScale(105.57, 105.7)).toBe(1);
    expect(fitScale(105.8, 105.8 + FIT_TOLERANCE_PX)).toBe(1);
  });

  it('shrinks an overflowing value to the column, from its width at the current scale', () => {
    // "+10,070 m" is ~122 px at 34 px in a 106 px column.
    expect(fitScale(105.8, 122.2)).toBe(0.865);
    // Already drawn at 0.865: the same answer, so it does not oscillate.
    expect(fitScale(105.8, 122.2 * 0.865, 0.865)).toBe(0.865);
    // The column widened: back to full size.
    expect(fitScale(146, 122.2 * 0.865, 0.865)).toBe(1);
  });

  it('is 1 when nothing can be measured (no layout)', () => {
    expect(fitScale(0, 0)).toBe(1);
    expect(fitScale(100, 0)).toBe(1);
    expect(fitScale(Number.NaN, 120)).toBe(1);
  });
});

describe('StatGrid value fitting', () => {
  /** px per character at 34 px: "+10,070 m" (9) is 108 px, "+1,070 m" (8) 96 px. */
  const PX_PER_CHAR = 12;
  const COLUMN = 100;
  /** Text-only zoom: the text grows, the column does not. */
  let textZoom = 1;
  type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;
  let observers: ResizeCallback[] = [];
  /** Animation frames waiting to run (run by `flushFrames`). */
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    observers = [];
    frames = [];
    textZoom = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeCallback) {
          observers.push(callback);
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    // Text width scales with the grid's --fit, as the CSS font size does.
    const scaleOf = (node: Node) =>
      parseFloat(node.parentElement?.closest('dl')?.style.getPropertyValue('--fit') ?? '') || 1;
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let node: Node | null = null;
      return {
        selectNodeContents: (target: Node) => {
          node = target;
        },
        getBoundingClientRect: () =>
          ({
            width: node
              ? (node.textContent ?? '').length * PX_PER_CHAR * textZoom * scaleOf(node)
              : 0,
          }) as DOMRect,
      } as unknown as Range;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: COLUMN }) as DOMRect,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fitOf = (container: HTMLElement) =>
    container.querySelector('dl')?.style.getPropertyValue('--fit') ?? '';
  const flushFrames = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  };
  /** The grid's width changed to `width`: the observer schedules a measure; run it. */
  let width = COLUMN * 2;
  const resizeTo = (next = (width += 1)) => {
    for (const callback of observers) callback([{ contentRect: { width: next } }]);
  };
  const remeasure = () => {
    resizeTo();
    flushFrames();
  };

  it('leaves normal values at full size (no --fit)', () => {
    const { container } = renderFourStats();
    expect(fitOf(container)).toBe('');
  });

  it('steps every value down together when one overflows, without wrapping it', () => {
    const { container, rerender } = render(
      <StatGrid>
        <StatTile label="Distance" value={171.4} unit="km" format={oneDecimal} />
        <StatTile label="Vert" value={10070} unit="m" emphasis format={signedGrouped} />
      </StatGrid>,
    );
    // 108 px wide in 100: 100 / 108 = 0.925.
    expect(fitOf(container)).toBe('0.925');
    // Measuring again at that scale settles on the same value.
    remeasure();
    expect(fitOf(container)).toBe('0.925');

    // Shorter values: back to full size.
    rerender(
      <StatGrid>
        <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
        <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
      </StatGrid>,
    );
    remeasure();
    expect(fitOf(container)).toBe('');
  });

  it('never writes --fit inside the ResizeObserver callback, and settles after its own write', () => {
    const { container, rerender } = render(
      <StatGrid>
        <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
      </StatGrid>,
    );
    rerender(
      <StatGrid>
        <StatTile label="Vert" value={10070} unit="m" emphasis format={signedGrouped} />
      </StatGrid>,
    );
    // A width change: nothing is written during the callback, one measure is queued (coalesced).
    resizeTo();
    resizeTo();
    expect(fitOf(container)).toBe('');
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(fitOf(container)).toBe('0.925');
    // The write changes the grid's height: one more measure, which finds the fit unchanged.
    resizeTo(width);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(fitOf(container)).toBe('0.925');
    expect(frames).toHaveLength(0);
  });

  it('re-fits on a height-only change (text-only zoom at the same width)', () => {
    const { container } = render(
      <StatGrid>
        <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
      </StatGrid>,
    );
    expect(fitOf(container)).toBe('');
    // Text at 150%: "+1,070 m" is 144 px in the same 100 px column; only the height changes.
    textZoom = 1.5;
    resizeTo(width);
    flushFrames();
    expect(fitOf(container)).toBe('0.694');
  });
});

describe('StatGrid without text layout (jsdom)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders without fitting and never throws, even with a ResizeObserver', () => {
    // jsdom's Range has no getBoundingClientRect.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    const { container } = render(
      <StatGrid>
        <StatTile label="Vert" value={10070} unit="m" emphasis format={signedGrouped} />
      </StatGrid>,
    );
    expect(container.querySelector('dl')?.style.getPropertyValue('--fit')).toBe('');
    expect(screen.getByRole('definition').textContent).toBe('+10,070 m');
  });
});
