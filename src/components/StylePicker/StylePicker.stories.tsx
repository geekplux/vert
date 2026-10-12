import type { Story } from '@ladle/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { POSTER_STYLES, StylePicker, type PosterStyleId } from './StylePicker';

export default { title: 'Components / StylePicker' };

// Poster mode aside: 380px wide with 40px left and 32px right padding, so 307px of content.
const column: CSSProperties = { width: 307, padding: '28px 0' };

const sectionLabel: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  color: 'var(--muted)',
};

function Section({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={sectionLabel} aria-hidden="true">
        STYLE
      </div>
      {children}
    </div>
  );
}

function Controlled({ initial }: { initial: PosterStyleId }) {
  const [value, setValue] = useState<PosterStyleId>(initial);
  return (
    <Section>
      <StylePicker styles={POSTER_STYLES} value={value} onChange={setValue} label="Style" />
    </Section>
  );
}

export const Default: Story = () => (
  <div style={column}>
    <Controlled initial="A" />
  </div>
);

export const NightRidgeSelected: Story = () => (
  <div style={column}>
    <Controlled initial="B" />
  </div>
);
NightRidgeSelected.storyName = 'Night Ridge selected';

/** Without colour the swatches still differ: paper lightness and the terrain hint's shape. */
export const Greyscale: Story = () => (
  <div style={{ ...column, filter: 'grayscale(1)' }}>
    <Controlled initial="A" />
  </div>
);
