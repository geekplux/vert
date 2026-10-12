import type { Story } from '@ladle/react';
import type { CSSProperties } from 'react';
import { StatGrid } from './StatGrid';
import { StatTile } from './StatTile';

export default { title: 'Components / StatTile' };

// Story-only formatters; the app's shared formatters arrive in src/lib in a later phase.
const oneDecimal = (value: number) => value.toFixed(1);
const signedGrouped = (value: number) => `+${value.toLocaleString('en-US')}`;
const hms = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// The Main frame's aside at 1440: 299.58px wide (border-box) with 40px left and 32px right padding,
// so the grid gets the canvas's 227.58px content width.
const aside: CSSProperties = {
  width: 299.58,
  padding: 'var(--space-8) var(--space-8) 0 var(--space-10)',
};

export const Distance: Story = () => (
  <div style={aside}>
    <StatGrid>
      <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
    </StatGrid>
  </div>
);

export const Vert: Story = () => (
  <div style={aside}>
    <StatGrid>
      <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
    </StatGrid>
  </div>
);

export const MovingTime: Story = () => (
  <div style={aside}>
    <StatGrid>
      <StatTile label="Moving time" value={11560} format={hms} />
    </StatGrid>
  </div>
);
MovingTime.storyName = 'Moving time';

export const HighPoint: Story = () => (
  <div style={aside}>
    <StatGrid>
      <StatTile label="High point" value={820} unit="m" />
    </StatGrid>
  </div>
);
HighPoint.storyName = 'High point';

export const Grid: Story = () => (
  <div style={aside}>
    <StatGrid>
      <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
      <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
      <StatTile label="Moving time" value={11560} format={hms} />
      <StatTile label="High point" value={820} unit="m" />
    </StatGrid>
  </div>
);
