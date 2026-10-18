import type { Story } from '@ladle/react';
import { useEffect } from 'react';
import { Page } from '../Page';
import { INITIAL_PREFS, INITIAL_SCREEN } from '../state';
import type { PageState, UploadScreen } from '../state';

// The whole page in the Upload state. Each story sets its width so Ladle renders it in an iframe
// of that size and media queries apply. Busy and Error inject the screen into the state machine.
export default { title: 'Page / Upload' };

function upload(screen: Partial<UploadScreen>): PageState {
  return { prefs: INITIAL_PREFS, screen: { ...INITIAL_SCREEN, ...screen } };
}

const BUSY = upload({ busy: { kind: 'reading', fileName: 'coosa-backcountry.gpx' } });
const ERROR = upload({ error: 'This file has no track points. Export the activity as GPX again.' });

export const Idle1440: Story = () => <Page />;
Idle1440.storyName = 'Idle 1440';
Idle1440.meta = { width: 1440 };

export const Idle390: Story = () => <Page />;
Idle390.storyName = 'Idle 390';
Idle390.meta = { width: 390 };

export const Busy1440: Story = () => <Page initialState={BUSY} />;
Busy1440.storyName = 'Busy 1440';
Busy1440.meta = { width: 1440 };

export const Busy390: Story = () => <Page initialState={BUSY} />;
Busy390.storyName = 'Busy 390';
Busy390.meta = { width: 390 };

export const Error1440: Story = () => <Page initialState={ERROR} />;
Error1440.storyName = 'Error 1440';
Error1440.meta = { width: 1440 };

export const Error390: Story = () => <Page initialState={ERROR} />;
Error390.storyName = 'Error 390';
Error390.meta = { width: 390 };

/**
 * A file held over the page: one synthetic `dragenter` carrying a file, so the page-wide drop
 * state (Dropzone copy and the frame round the viewport) stays up. Click away from the window
 * (blur) to clear it, or drop a real file.
 */
function DraggingPage() {
  useEffect(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['<gpx/>'], 'held.gpx', { type: 'application/gpx+xml' }));
    document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
  }, []);
  return <Page />;
}

export const DragOver1440: Story = () => <DraggingPage />;
DragOver1440.storyName = 'Drag over 1440';
DragOver1440.meta = { width: 1440 };

export const DragOver390: Story = () => <DraggingPage />;
DragOver390.storyName = 'Drag over 390';
DragOver390.meta = { width: 390 };
