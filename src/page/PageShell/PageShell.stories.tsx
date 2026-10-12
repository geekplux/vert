import type { Story } from '@ladle/react';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { TextField } from '../../components/TextField/TextField';
import { AppHeader } from '../AppHeader/AppHeader';
import { PosterNav } from '../AppHeader/PosterNav';
import { UploadNav } from '../AppHeader/UploadNav';
import { ViewNav } from '../AppHeader/ViewNav';
import { PageShell } from './PageShell';
import { UploadLayout } from './UploadLayout';

// Each story sets its width so Ladle renders it in an iframe of that size and media queries apply.
export default { title: 'Page / PageShell' };

const noop = () => undefined;

const page: CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: '100dvh' };

function Box({
  label,
  style,
  children,
}: {
  label: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        alignContent: children ? 'start' : undefined,
        gap: 'var(--space-3)',
        padding: children ? 'var(--space-4)' : undefined,
        minHeight: 80,
        background: 'var(--surface)',
        border: '1px dashed var(--rule-strong)',
        borderRadius: 'var(--radius-panel)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--muted)',
        ...style,
      }}
    >
      {label}
      {children}
    </div>
  );
}

/** Stretches placeholder controls to the box width. */
const stack: CSSProperties = { display: 'grid', gap: 'var(--space-2)', width: '100%' };

/*
 * The poster aside scrolls, so it must hold focusable content: otherwise Chrome makes the scroller
 * itself a Tab stop (axe scrollable-region-focusable). Placeholder values; the real controls come
 * with the poster state.
 */
function PosterSettings() {
  const [title, setTitle] = useState('Coosa Backcountry Loop');
  const [subtitle, setSubtitle] = useState('Talladega National Forest');
  const [showStats, setShowStats] = useState(true);
  const [showClimbs, setShowClimbs] = useState(false);
  return (
    <>
      <Box label="style" style={{ minHeight: 160 }}>
        <div style={stack}>
          <Button variant="secondary">Placeholder style A</Button>
          <Button variant="secondary">Placeholder style B</Button>
        </div>
      </Box>
      <Box label="size" style={{ minHeight: 120 }}>
        <div style={stack}>
          <Button variant="secondary">Placeholder size</Button>
        </div>
      </Box>
      <Box label="text fields" style={{ minHeight: 220 }}>
        <div style={stack}>
          <TextField label="Title" value={title} onChange={setTitle} maxLength={40} />
          <TextField label="Subtitle" value={subtitle} onChange={setSubtitle} maxLength={60} />
        </div>
      </Box>
      <Box label="stats + slider" style={{ minHeight: 200 }}>
        <div style={stack}>
          <Checkbox label="Show stats" checked={showStats} onChange={setShowStats} />
          <Checkbox label="Show climbs" checked={showClimbs} onChange={setShowClimbs} />
        </div>
      </Box>
      <Box label="download" style={{ minHeight: 120 }}>
        <div style={stack}>
          <Button variant="primary" size="lg">
            Placeholder download
          </Button>
        </div>
      </Box>
    </>
  );
}

const ViewPage = () => (
  <div style={page}>
    <AppHeader state="view">
      <ViewNav units="metric" onUnitsChange={noop} onNewFile={noop} onMakePoster={noop} />
    </AppHeader>
    <PageShell
      asideLabel="Run details"
      aside={
        <>
          <Box label="date + h1" />
          <Box label="stats 2×2" style={{ minHeight: 140 }} />
          <Box label="climbs" style={{ minHeight: 160 }} />
          <Box label="exaggeration slider" />
        </>
      }
    >
      <Box label="terrain 4:3" style={{ aspectRatio: '4 / 3' }} />
      <Box label="elevation profile" style={{ minHeight: 100 }} />
    </PageShell>
  </div>
);

const PosterPage = () => (
  <div style={{ ...page, height: '100dvh' }}>
    <AppHeader state="poster" routeName="Coosa Backcountry Loop">
      <PosterNav onBack={noop} />
    </AppHeader>
    <PageShell asideLabel="Poster settings" asideWidth="poster" aside={<PosterSettings />}>
      <Box
        label="poster 3:4"
        style={{
          width: 'min(100%, 420px)',
          aspectRatio: '3 / 4',
          background: 'var(--white)',
        }}
      />
    </PageShell>
  </div>
);

const UploadPage = () => (
  <div style={page}>
    <AppHeader state="upload">
      <UploadNav onAbout={noop} />
    </AppHeader>
    <UploadLayout
      left={<Box label="h1 + intro + dropzone + note" style={{ minHeight: 420 }} />}
      right={<Box label="sample preview 4:3" style={{ aspectRatio: '4 / 3' }} />}
    />
  </div>
);

export const View1440: Story = () => <ViewPage />;
View1440.storyName = 'View 1440';
View1440.meta = { width: 1440 };

export const View900: Story = () => <ViewPage />;
View900.storyName = 'View 900';
View900.meta = { width: 900 };

export const View390: Story = () => <ViewPage />;
View390.storyName = 'View 390';
View390.meta = { width: 390 };

export const Poster1440: Story = () => <PosterPage />;
Poster1440.storyName = 'Poster 1440';
Poster1440.meta = { width: 1440 };

export const Poster900: Story = () => <PosterPage />;
Poster900.storyName = 'Poster 900';
Poster900.meta = { width: 900 };

export const Poster390: Story = () => <PosterPage />;
Poster390.storyName = 'Poster 390';
Poster390.meta = { width: 390 };

export const Upload1440: Story = () => <UploadPage />;
Upload1440.storyName = 'Upload 1440';
Upload1440.meta = { width: 1440 };

export const Upload900: Story = () => <UploadPage />;
Upload900.storyName = 'Upload 900';
Upload900.meta = { width: 900 };

export const Upload390: Story = () => <UploadPage />;
Upload390.storyName = 'Upload 390';
Upload390.meta = { width: 390 };
