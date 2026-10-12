import type { Story } from '@ladle/react';
import type { CSSProperties } from 'react';
import { Marker, MarkerShape } from './Marker';

export default { title: 'Components / Marker' };

const pad: CSSProperties = { padding: 'var(--space-10)' };

export const Start: Story = () => (
  <div style={pad}>
    <Marker kind="start" label="Start / finish" />
  </div>
);

/** A point-to-point run's finish (◉): the start circle with an ink dot, as the terrain draws it. */
export const Finish: Story = () => (
  <div style={pad}>
    <Marker kind="finish" label="Finish" />
  </div>
);

export const Summit: Story = () => (
  <div style={pad}>
    <Marker kind="summit" label="Summit" />
  </div>
);

export const Scrub: Story = () => (
  <div style={pad}>
    <Marker kind="scrub" label="Scrub position" />
  </div>
);

const item: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' };

/** Canvas frame 00, "MARKERS · never color alone". */
export const Legend: Story = () => (
  <div style={{ ...pad, display: 'flex', alignItems: 'center', gap: 20, fontSize: 14 }}>
    <span style={item}>
      <Marker kind="start" />
      Start / finish
    </span>
    <span style={item}>
      <Marker kind="summit" />
      Summit
    </span>
    <span style={item}>
      <Marker kind="scrub" />
      Scrub position
    </span>
  </div>
);

/** A point-to-point run: separate start (○) and finish (◉) entries. */
export const PointToPointLegend: Story = () => (
  <div style={{ ...pad, display: 'flex', alignItems: 'center', gap: 20, fontSize: 14 }}>
    <span style={item}>
      <Marker kind="start" />
      Start
    </span>
    <span style={item}>
      <Marker kind="finish" />
      Finish
    </span>
    <span style={item}>
      <Marker kind="summit" />
      Summit
    </span>
  </div>
);
PointToPointLegend.storyName = 'Point-to-point legend';

export const Sizes: Story = () => (
  <div style={{ ...pad, display: 'grid', gap: 'var(--space-4)' }}>
    {[18, 24, 32].map((size) => (
      <div key={size} style={{ ...item, gap: 'var(--space-4)' }}>
        <Marker kind="start" size={size} />
        <Marker kind="finish" size={size} />
        <Marker kind="summit" size={size} />
        <Marker kind="scrub" size={size} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{size}px</span>
      </div>
    ))}
  </div>
);

/**
 * Night Ridge (poster style B) palette. Hard-coded on purpose: poster palettes are not tokens.
 * `paper` is the background here, so the scrub ring takes the ink (`ring`) or it would vanish, and
 * the ink ring is only 1.16:1 from the pale route fill, so a paper `gap` separates the two.
 */
const nightRidge = {
  ink: '#E8F1F5',
  paper: '#0F2233',
  accent: '#FFD9A0',
  ring: '#E8F1F5',
  gap: '#0F2233',
};

export const OnDark: Story = () => (
  <div
    style={{
      ...pad,
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      fontSize: 14,
      background: '#0F2233',
      color: '#E8F1F5',
    }}
  >
    <span style={item}>
      <Marker kind="start" {...nightRidge} />
      Start / finish
    </span>
    <span style={item}>
      <Marker kind="summit" {...nightRidge} />
      Summit
    </span>
    <span style={item}>
      <Marker kind="scrub" {...nightRidge} />
      Scrub position
    </span>
  </div>
);
OnDark.storyName = 'On dark';

/** MarkerShape drawn inside a host SVG, as the elevation profile and posters do. */
export const Embedded: Story = () => (
  <div style={pad}>
    <svg width={200} height={60} viewBox="0 0 200 60" role="img" aria-label="Profile sketch">
      <rect width={200} height={60} style={{ fill: 'var(--surface)' }} />
      <polyline
        points="20,48 60,36 100,12 140,30 180,48"
        strokeWidth={2}
        style={{ fill: 'none', stroke: 'var(--route)' }}
      />
      <MarkerShape kind="start" x={20} y={48} />
      <MarkerShape kind="finish" x={180} y={48} />
      <MarkerShape kind="summit" x={100} y={12} />
      <MarkerShape kind="scrub" x={140} y={30} />
    </svg>
  </div>
);
