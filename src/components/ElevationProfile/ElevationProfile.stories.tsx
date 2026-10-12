import type { Story } from '@ladle/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ElevationProfile, type Climb, type ProfilePoint } from './ElevationProfile';
import { SAMPLE_CLIMBS, SAMPLE_POINTS } from './sampleProfile';

export default { title: 'Components / ElevationProfile' };

// The Main frame's main column at 1440: 1139.42px wide with 40px side padding, so the profile gets
// the canvas's 1059.42px. At 390 the column has 40px side padding too (310px plot).
const view: CSSProperties = { width: 1139.42, padding: '24px 40px' };
const phone: CSSProperties = { width: 390, padding: '24px 40px' };

// Story-only stand-in for the page's header row above the profile (canvas: section gap 6px).
const headerRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  gap: 8,
  fontFamily: 'var(--font-mono)',
};

function Section({ range, children }: { range: string; children: ReactNode }) {
  return (
    <section
      aria-label="Elevation profile"
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={headerRow}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)' }}>{range}</div>
      </div>
      {children}
    </section>
  );
}

function Interactive({
  points = SAMPLE_POINTS,
  climbs = SAMPLE_CLIMBS,
  initial = 12_200,
  height,
  units,
}: {
  points?: ProfilePoint[];
  climbs?: Climb[];
  initial?: number;
  height?: number;
  units?: 'metric' | 'imperial';
}) {
  const [scrub, setScrub] = useState(initial);
  return (
    <ElevationProfile
      points={points}
      climbs={climbs}
      scrub={scrub}
      onScrub={setScrub}
      height={height}
      units={units}
    />
  );
}

export const View: Story = () => (
  <div style={view}>
    <Section range="ELEVATION · 300–820 m">
      <Interactive />
    </Section>
  </div>
);

export const Phone: Story = () => (
  <div style={phone}>
    <Section range="ELEVATION · 300–820 m">
      <Interactive height={100} />
    </Section>
  </div>
);

export const Imperial: Story = () => (
  <div style={view}>
    <Section range="ELEVATION · 984–2,690 ft">
      <Interactive units="imperial" />
    </Section>
  </div>
);

const flat: ProfilePoint[] = Array.from({ length: 300 }, (_, i) => ({ d: i * 30, ele: 120 }));

export const Flat: Story = () => (
  <div style={view}>
    <Section range="ELEVATION · 120 m">
      <Interactive points={flat} climbs={[]} initial={4_000} />
    </Section>
  </div>
);

export const Empty: Story = () => (
  <div style={view}>
    <Section range="ELEVATION">
      <Interactive points={[]} climbs={[]} initial={0} />
    </Section>
  </div>
);
