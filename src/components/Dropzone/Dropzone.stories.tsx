import { action } from '@ladle/react';
import type { Story } from '@ladle/react';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Dropzone } from './Dropzone';

export default { title: 'Components / Dropzone' };

/** The Upload frame's left column: 560px of content, on the page background. */
const column: CSSProperties = {
  maxWidth: 'calc(560px + 2 * var(--space-10))',
  padding: 'var(--space-10)',
  background: 'var(--bg)',
};

const Column = ({ children }: { children: ReactNode }) => <div style={column}>{children}</div>;

const noop = () => undefined;

/** Logs name, size and type only: a File object does not serialise into Ladle's action panel. */
const logFile = (file: File) => {
  action('onFile')({ name: file.name, size: file.size, type: file.type });
};

/** Rest. Hover draws the dashed border in ink; Tab shows the focus ring. Touch screens read
 * "Choose a .gpx file · Tap to open your files" (try your browser's device emulation). */
export const Default: Story = () => (
  <Column>
    <Dropzone onFile={logFile} onSample={action('onSample')} />
  </Column>
);
Default.storyName = 'Rest';

/** What the page draws while a file is dragged anywhere over it (`dragOver`). */
export const DragOver: Story = () => (
  <Column>
    <Dropzone onFile={noop} onSample={noop} dragOver />
  </Column>
);
DragOver.storyName = 'Drag over';

export const ErrorWrongType: Story = () => (
  <Column>
    <Dropzone
      onFile={noop}
      onSample={noop}
      error="That's a .fit file. Vert reads .gpx files in v1."
    />
  </Column>
);
ErrorWrongType.storyName = 'Error · wrong type';

export const ErrorTooLarge: Story = () => (
  <Column>
    <Dropzone onFile={noop} onSample={noop} error="That file is 24.3 MB. The limit is 20 MB." />
  </Column>
);
ErrorTooLarge.storyName = 'Error · too large';

/** Disabled, with the progress line along the bottom (still under reduced motion). */
export const Busy: Story = () => (
  <Column>
    <Dropzone onFile={noop} onSample={noop} busy fileName="coosa-backcountry.gpx" />
  </Column>
);

const logStyle: CSSProperties = {
  margin: 'var(--space-4) 0 0',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--muted)',
  whiteSpace: 'pre-wrap',
};

/** Drop or choose real files: valid ones are logged (name and size only; nothing is read). */
export const Interactive: Story = () => {
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) => {
    setLog((lines) => [line, ...lines].slice(0, 8));
  };
  return (
    <Column>
      <Dropzone
        onFile={(file) => {
          logFile(file);
          append(`onFile: ${file.name} · ${String(file.size)} bytes`);
        }}
        onSample={() => {
          action('onSample')();
          append('onSample');
        }}
      />
      <p style={logStyle} aria-live="polite">
        {log.length ? log.join('\n') : 'No events yet.'}
      </p>
    </Column>
  );
};
