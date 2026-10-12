import type { Story } from '@ladle/react';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { ExportingScreen, PageState } from '../state';

// The whole page in Poster mode with the export overlay (DESIGN-SPEC §3 "04 Exporting"), held at
// tile 4 of 12. Opening on a stored state starts no export; Cancel returns to Poster mode, and
// Download then runs the app's `defaultExporter` (see exporter.ts).
export default { title: 'Page / Exporting' };

const FILE = 'vert-coosa-backcountry-trail-18x24.png';

function state(screen: ExportingScreen): PageState {
  return {
    screen,
    prefs: {
      ...INITIAL_PREFS,
      poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN) },
    },
  };
}

const EXPORTING = state({
  name: 'exporting',
  runId: SAMPLE_RUN.id,
  fileName: FILE,
  // Three tiles done: "Rendering tile 4 of 12".
  progress: { done: 3, total: 12 },
});

export const Exporting1440: Story = () => <Page initialRun={SAMPLE_RUN} initialState={EXPORTING} />;
Exporting1440.storyName = 'Exporting 1440';
Exporting1440.meta = { width: 1440 };

export const Exporting390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={EXPORTING} />;
Exporting390.storyName = 'Exporting 390';
Exporting390.meta = { width: 390 };

// Before the exporter reports its tile count: an indeterminate bar and "Preparing…".
const PREPARING = state({
  name: 'exporting',
  runId: SAMPLE_RUN.id,
  fileName: FILE,
  progress: { done: 0, total: null },
});

export const Preparing390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={PREPARING} />;
Preparing390.storyName = 'Preparing 390';
Preparing390.meta = { width: 390 };
