import type { Story } from '@ladle/react';
import type { CSSProperties } from 'react';

export default { title: 'Foundations / Tokens' };

const colors = [
  ['--bg', 'page'],
  ['--surface', 'terrain canvas, poster paper'],
  ['--ink', 'text, primary buttons, terrain lines'],
  ['--muted', 'secondary text, labels'],
  ['--rule', 'borders, dividers'],
  ['--route', 'route, scrub marker, vert number'],
  ['--white', 'white'],
] as const;

const label: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};

const page: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-8)',
  padding: 'var(--space-10)',
  maxWidth: 960,
};

export const Color: Story = () => (
  <div style={page}>
    <h2 style={label}>Color · app chrome (style A)</h2>
    <ul
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 'var(--space-4)',
        margin: 0,
        padding: 0,
        listStyle: 'none',
      }}
    >
      {colors.map(([token, use]) => (
        <li key={token} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span
            aria-hidden="true"
            style={{
              width: 'var(--touch)',
              height: 'var(--touch)',
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--rule)',
              background: `var(${token})`,
            }}
          />
          <span>
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{token}</code>
            <br />
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>{use}</span>
          </span>
        </li>
      ))}
    </ul>
  </div>
);

export const Type: Story = () => (
  <div style={page}>
    <div>
      <p style={label}>Display · 72 / 800 / 75%</p>
      <p
        style={{
          margin: 0,
          fontSize: 72,
          fontWeight: 800,
          fontStretch: '75%',
          letterSpacing: '-0.01em',
          lineHeight: 0.95,
        }}
      >
        Your run, as terrain.
      </p>
    </div>
    <div>
      <p style={label}>Wordmark · 30 / 800 / 62%</p>
      <p
        style={{
          margin: 0,
          fontSize: 30,
          fontWeight: 800,
          fontStretch: '62%',
          letterSpacing: '0.04em',
        }}
      >
        VERT
      </p>
    </div>
    <div>
      <p style={label}>Stat · 34 / 700 / 75%, unit 16 / 500</p>
      <p
        style={{
          margin: 0,
          fontSize: 34,
          fontWeight: 700,
          fontStretch: '75%',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--route)',
        }}
      >
        +1,070<span style={{ fontSize: 16, fontWeight: 500 }}> m</span>
      </p>
    </div>
    <div>
      <p style={label}>Body · 16 / 400</p>
      <p style={{ margin: 0, maxWidth: '60ch' }}>
        Drop a GPX file and Vert draws the ground you covered. Everything happens in your browser;
        the file never leaves your machine.
      </p>
    </div>
    <div>
      <p style={label}>Label · 12 mono, uppercase, 0.08em</p>
      <p style={{ ...label, margin: 0 }}>Elevation · 300–820 m</p>
    </div>
  </div>
);
