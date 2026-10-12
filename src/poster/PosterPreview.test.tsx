import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { PosterPreview } from './PosterPreview';
import { posterSizeById } from './sizes';

function Poster() {
  return <div role="img" aria-label="Poster: test" />;
}

/** The element that scales the poster, and the frame around it. */
function parts(): { scaler: HTMLElement; frame: HTMLElement } {
  const scaler = screen.getByRole('img').parentElement;
  const frame = scaler?.parentElement;
  if (!scaler || !frame) throw new Error('PosterPreview structure changed');
  return { scaler, frame };
}

function scaleOf(element: HTMLElement): number {
  const match = /scale\(([\d.]+)\)/.exec(element.style.transform);
  return Number(match?.[1]);
}

describe('PosterPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fits 18×24 into the default 600 × 800 box', () => {
    render(
      <PosterPreview size={posterSizeById('18x24')}>
        <Poster />
      </PosterPreview>,
    );
    const { scaler, frame } = parts();
    expect(frame.style.width).toBe('600px');
    expect(frame.style.aspectRatio).toBe('720 / 960');
    expect(scaleOf(scaler)).toBeCloseTo(600 / 720, 6);
  });

  it('is limited by height for the tall story size', () => {
    render(
      <PosterPreview size={posterSizeById('9x16')}>
        <Poster />
      </PosterPreview>,
    );
    const { scaler, frame } = parts();
    expect(frame.style.width).toBe('450px');
    expect(scaleOf(scaler)).toBeCloseTo(450 / 1080, 6);
  });

  it('rescales to the frame width the ResizeObserver reports', () => {
    let notify: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      },
    );
    render(
      <PosterPreview size={posterSizeById('4x5')} maxWidth={540} maxHeight={1000}>
        <Poster />
      </PosterPreview>,
    );
    const { scaler, frame } = parts();
    expect(scaleOf(scaler)).toBeCloseTo(0.5, 6);
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 270 });
    act(() => {
      notify();
    });
    expect(scaleOf(scaler)).toBeCloseTo(0.25, 6);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <PosterPreview size={posterSizeById('a3')}>
        <Poster />
      </PosterPreview>,
    );
    await expectNoAxeViolations(container);
  });
});
