import type { Story } from '@ladle/react';
import type { CSSProperties } from 'react';
import { Button } from './Button';

export default { title: 'Components / Button' };

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-10)',
};

const column: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-6)',
  padding: 'var(--space-10)',
  maxWidth: 480,
};

const label: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 400,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
};

/** Rotate icon from canvas frame 02 View. */
const RotateIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </svg>
);

const log = (name: string) => () => {
  console.info(`clicked: ${name}`);
};

export const Primary: Story = () => (
  <div style={row}>
    <Button variant="primary" onClick={log('Make a poster')}>
      Make a poster
    </Button>
  </div>
);

export const Secondary: Story = () => (
  <div style={row}>
    <Button variant="secondary" onClick={log('New file')}>
      New file
    </Button>
  </div>
);

export const Quiet: Story = () => (
  <div style={row}>
    <Button variant="quiet" onClick={log('Cancel')}>
      Cancel
    </Button>
  </div>
);

export const Icon: Story = () => (
  <div style={row}>
    <Button variant="icon" aria-label="Rotate view" onClick={log('Rotate view')}>
      <RotateIcon />
    </Button>
  </div>
);

export const SizeMedium: Story = () => (
  <div style={row}>
    <Button variant="primary">Make a poster</Button>
    <Button variant="secondary">Download PDF for print</Button>
  </div>
);
SizeMedium.storyName = 'Size md';

export const SizeLarge: Story = () => (
  <div style={row}>
    <Button variant="primary" size="lg" onClick={log('Download PNG')}>
      Download PNG · 5400 × 7200
    </Button>
  </div>
);
SizeLarge.storyName = 'Size lg';

export const Disabled: Story = () => (
  <div style={row}>
    <Button variant="primary" size="lg" disabled>
      Download PNG · 5400 × 7200
    </Button>
    <Button variant="secondary" disabled>
      New file
    </Button>
    <Button variant="quiet" disabled>
      Cancel
    </Button>
    <Button variant="icon" aria-label="Rotate view" disabled>
      <RotateIcon />
    </Button>
  </div>
);

export const AsLink: Story = () => (
  <div style={row}>
    <Button variant="primary" href="#poster">
      Make a poster
    </Button>
    <Button variant="secondary" href="#view">
      Back to the run
    </Button>
  </div>
);
AsLink.storyName = 'As link (navigation)';

export const All: Story = () => (
  <div style={column}>
    <h2 style={label}>Variants · md</h2>
    <div style={{ ...row, padding: 0 }}>
      <Button variant="primary">Make a poster</Button>
      <Button variant="secondary">New file</Button>
      <Button variant="quiet">Cancel</Button>
      <Button variant="icon" aria-label="Rotate view">
        <RotateIcon />
      </Button>
    </div>
    <h2 style={label}>Size lg</h2>
    <div style={{ ...row, padding: 0 }}>
      <Button variant="primary" size="lg">
        Download PNG · 5400 × 7200
      </Button>
    </div>
    <h2 style={label}>Links</h2>
    <div style={{ ...row, padding: 0 }}>
      <Button variant="primary" href="#poster">
        Make a poster
      </Button>
      <Button variant="secondary" href="#view">
        Back to the run
      </Button>
    </div>
    <h2 style={label}>Disabled</h2>
    <div style={{ ...row, padding: 0 }}>
      <Button variant="primary" disabled>
        Make a poster
      </Button>
      <Button variant="secondary" disabled>
        New file
      </Button>
      <Button variant="quiet" disabled>
        Cancel
      </Button>
      <Button variant="icon" aria-label="Rotate view" disabled>
        <RotateIcon />
      </Button>
    </div>
  </div>
);
