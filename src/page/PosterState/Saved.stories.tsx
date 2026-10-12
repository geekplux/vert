import type { Story } from '@ladle/react';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PageState, PosterScreen } from '../state';

// Poster mode after an export (DESIGN-SPEC §3 "04 Exporting"): "Saved <file>" with a check under
// the Download button. Download runs the app's `defaultExporter` again (see exporter.ts).
export default { title: 'Page / Saved' };

const FILE = 'vert-coosa-backcountry-trail-18x24.png';

function state(screen: PosterScreen): PageState {
  return {
    screen,
    prefs: {
      ...INITIAL_PREFS,
      poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN) },
    },
  };
}

const SAVED = state({
  name: 'poster',
  runId: SAMPLE_RUN.id,
  notice: { kind: 'saved', fileName: FILE },
});

export const Saved1440: Story = () => <Page initialRun={SAMPLE_RUN} initialState={SAVED} />;
Saved1440.storyName = 'Saved 1440';
Saved1440.meta = { width: 1440 };

export const Saved390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={SAVED} />;
Saved390.storyName = 'Saved 390';
Saved390.meta = { width: 390 };

// The other way an export ends: the error, with a warning glyph, in --route-text.
const FAILED = state({
  name: 'poster',
  runId: SAMPLE_RUN.id,
  notice: { kind: 'failed', message: 'The export failed. Try again.' },
});

export const Failed1440: Story = () => <Page initialRun={SAMPLE_RUN} initialState={FAILED} />;
Failed1440.storyName = 'Failed 1440';
Failed1440.meta = { width: 1440 };

export const Failed390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={FAILED} />;
Failed390.storyName = 'Failed 390';
Failed390.meta = { width: 390 };
