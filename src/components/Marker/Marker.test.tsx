import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { Marker, MarkerShape } from './Marker';

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg;
}

describe('Marker', () => {
  it('draws start as a hollow circle: r 6, white fill, ink 2.5 stroke', () => {
    const { container } = render(<Marker kind="start" />);
    const circle = svgOf(container).querySelector('circle');
    expect(svgOf(container).querySelector('path')).toBeNull();
    expect(circle?.getAttribute('cx')).toBe('9');
    expect(circle?.getAttribute('cy')).toBe('9');
    expect(circle?.getAttribute('r')).toBe('6');
    expect(circle?.getAttribute('stroke-width')).toBe('2.5');
    expect(circle?.style.fill).toBe('var(--white)');
    expect(circle?.style.stroke).toBe('var(--ink)');
  });

  it('draws finish as the start circle with a solid ink dot in the middle', () => {
    const { container } = render(<Marker kind="finish" />);
    const [ring, dot, extra] = Array.from(svgOf(container).querySelectorAll('circle'));
    expect(extra).toBeUndefined();
    expect(svgOf(container).querySelector('path')).toBeNull();
    expect(ring?.getAttribute('r')).toBe('6');
    expect(ring?.getAttribute('stroke-width')).toBe('2.5');
    expect(ring?.style.fill).toBe('var(--white)');
    expect(ring?.style.stroke).toBe('var(--ink)');
    expect(dot?.getAttribute('cx')).toBe('9');
    expect(dot?.getAttribute('cy')).toBe('9');
    expect(dot?.style.fill).toBe('var(--ink)');
    expect(dot?.hasAttribute('stroke-width')).toBe(false);
    // The terrain's proportions: a 7 px dot in a 22 px ring.
    expect((2 * Number(dot?.getAttribute('r'))) / 14.5).toBeCloseTo(7 / 22, 2);
  });

  it('keeps start a single circle, so finish never reads as a second start', () => {
    const { container } = render(<Marker kind="start" />);
    expect(svgOf(container).querySelectorAll('circle')).toHaveLength(1);
  });

  it('draws summit as a solid ink triangle', () => {
    const { container } = render(<Marker kind="summit" />);
    const path = svgOf(container).querySelector('path');
    expect(svgOf(container).querySelector('circle')).toBeNull();
    expect(path?.getAttribute('d')).toBe('M9 2 L16 15 L2 15 Z');
    expect(path?.style.fill).toBe('var(--ink)');
  });

  it('draws scrub as a small route dot with a 2.5 white ring', () => {
    const { container } = render(<Marker kind="scrub" />);
    const circle = svgOf(container).querySelector('circle');
    expect(circle?.getAttribute('r')).toBe('5');
    expect(circle?.getAttribute('stroke-width')).toBe('2.5');
    expect(circle?.style.fill).toBe('var(--route)');
    expect(circle?.style.stroke).toBe('var(--white)');
  });

  it('is decorative by default', () => {
    const { container } = render(<Marker kind="start" />);
    const svg = svgOf(container);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.hasAttribute('role')).toBe(false);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is an image named by its label', () => {
    render(<Marker kind="summit" label="Summit 820 m" />);
    const img = screen.getByRole('img', { name: 'Summit 820 m' });
    expect(img.hasAttribute('aria-hidden')).toBe(false);
  });

  it('defaults to 18px and scales with size through the 18-unit viewBox', () => {
    const { container, rerender } = render(<Marker kind="scrub" />);
    expect(svgOf(container).getAttribute('width')).toBe('18');
    expect(svgOf(container).getAttribute('viewBox')).toBe('0 0 18 18');
    rerender(<Marker kind="scrub" size={32} />);
    expect(svgOf(container).getAttribute('width')).toBe('32');
    expect(svgOf(container).getAttribute('height')).toBe('32');
    expect(svgOf(container).getAttribute('viewBox')).toBe('0 0 18 18');
  });

  it('applies poster colour overrides', () => {
    const colors = { ink: '#E8F1F5', paper: '#0F2233', accent: '#FFD9A0' };
    const { container: start } = render(<Marker kind="start" {...colors} />);
    const { container: finish } = render(<Marker kind="finish" {...colors} />);
    const { container: summit } = render(<Marker kind="summit" {...colors} />);
    const { container: scrub } = render(<Marker kind="scrub" {...colors} />);
    const startCircle = svgOf(start).querySelector('circle');
    const scrubCircle = svgOf(scrub).querySelector('circle');
    expect(startCircle?.style.fill).toBe('rgb(15, 34, 51)');
    expect(startCircle?.style.stroke).toBe('rgb(232, 241, 245)');
    const [finishRing, finishDot] = Array.from(svgOf(finish).querySelectorAll('circle'));
    expect(finishRing?.style.fill).toBe('rgb(15, 34, 51)');
    expect(finishRing?.style.stroke).toBe('rgb(232, 241, 245)');
    expect(finishDot?.style.fill).toBe('rgb(232, 241, 245)');
    expect(svgOf(summit).querySelector('path')?.style.fill).toBe('rgb(232, 241, 245)');
    expect(scrubCircle?.style.fill).toBe('rgb(255, 217, 160)');
    expect(scrubCircle?.style.stroke).toBe('rgb(15, 34, 51)');
  });

  it('draws the scrub ring in `ring` when given, leaving the other shapes alone', () => {
    const colors = { ink: '#E8F1F5', paper: '#0F2233', accent: '#FFD9A0', ring: '#E8F1F5' };
    const { container: scrub } = render(<Marker kind="scrub" {...colors} />);
    const { container: start } = render(<Marker kind="start" {...colors} />);
    const scrubCircle = svgOf(scrub).querySelector('circle');
    expect(scrubCircle?.style.fill).toBe('rgb(255, 217, 160)');
    expect(scrubCircle?.style.stroke).toBe('rgb(232, 241, 245)');
    expect(svgOf(start).querySelector('circle')?.style.fill).toBe('rgb(15, 34, 51)');
  });

  it('has no axe violations, decorative or labelled', async () => {
    const { container } = render(
      <p>
        <Marker kind="start" /> Start / finish <Marker kind="finish" label="Finish" />
        <Marker kind="summit" label="Summit" />
        <Marker kind="scrub" label="Scrub position" />
      </p>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('MarkerShape', () => {
  it('renders a <g> centred on (x, y) and scaled to size', () => {
    const { container } = render(
      <svg>
        <MarkerShape kind="summit" x={100} y={30} size={36} />
      </svg>,
    );
    const g = container.querySelector('svg > g');
    expect(g?.getAttribute('transform')).toBe('translate(82 12) scale(2)');
    expect(g?.querySelector('path')?.getAttribute('d')).toBe('M9 2 L16 15 L2 15 Z');
  });

  it('puts a gap band between the scrub fill and its ring when asked (Night Ridge)', () => {
    const { container } = render(
      <svg>
        <MarkerShape kind="scrub" accent="#FFD9A0" ring="#E8F1F5" gap="#0F2233" />
        <MarkerShape kind="scrub" accent="#FFD9A0" ring="#E8F1F5" />
      </svg>,
    );
    const [withGap, plain] = Array.from(container.querySelectorAll('g'));
    const [ring, dot] = Array.from(withGap?.querySelectorAll('circle') ?? []);
    // The ring's outer edge stays where it was (6.25); inside it the gap, then the dot.
    expect(Number(ring?.getAttribute('r')) + Number(ring?.getAttribute('stroke-width')) / 2).toBe(
      6.25,
    );
    expect(ring?.style.stroke).toBe('rgb(232, 241, 245)');
    expect(ring?.style.fill).toBe('rgb(15, 34, 51)');
    expect(dot?.style.fill).toBe('rgb(255, 217, 160)');
    // Gap band: from the dot's edge (3.5) to the ring's inner edge (4.25).
    expect(Number(dot?.getAttribute('r'))).toBeLessThan(
      Number(ring?.getAttribute('r')) - Number(ring?.getAttribute('stroke-width')) / 2,
    );
    // Without a gap the scrub is unchanged: one circle, fill and ring.
    expect(plain?.querySelectorAll('circle')).toHaveLength(1);
  });

  it('defaults to an 18-unit box centred on the origin', () => {
    const { container } = render(
      <svg>
        <MarkerShape kind="start" />
      </svg>,
    );
    expect(container.querySelector('g')?.getAttribute('transform')).toBe(
      'translate(-9 -9) scale(1)',
    );
  });
});
