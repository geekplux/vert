import type { Story } from '@ladle/react';
import { Page } from '../Page';
import { SAMPLE_RUN } from '../sample';
import { INITIAL_PREFS, posterTextFor } from '../state';
import type { PageState, PosterPrefs } from '../state';

// The whole page in Poster mode with the sample run loaded, its poster text seeded as RUN_LOADED
// does. Each story sets its width so Ladle renders it in an iframe of that size and media queries
// apply.
export default { title: 'Page / Poster' };

function posterState(poster: Partial<PosterPrefs> = {}): PageState {
  return {
    screen: { name: 'poster', runId: SAMPLE_RUN.id, notice: null },
    prefs: {
      ...INITIAL_PREFS,
      poster: { ...INITIAL_PREFS.poster, ...posterTextFor(SAMPLE_RUN), ...poster },
    },
  };
}

const POSTER = posterState();

export const Poster1440: Story = () => <Page initialRun={SAMPLE_RUN} initialState={POSTER} />;
Poster1440.storyName = 'Poster 1440';
Poster1440.meta = { width: 1440 };

export const Poster900: Story = () => <Page initialRun={SAMPLE_RUN} initialState={POSTER} />;
Poster900.storyName = 'Poster 900';
Poster900.meta = { width: 900 };

export const Poster390: Story = () => <Page initialRun={SAMPLE_RUN} initialState={POSTER} />;
Poster390.storyName = 'Poster 390';
Poster390.meta = { width: 390 };

export const A3: Story = () => (
  <Page initialRun={SAMPLE_RUN} initialState={posterState({ size: 'a3' })} />
);
A3.storyName = 'A3';
A3.meta = { width: 1440 };

export const Social4x5: Story = () => (
  <Page
    initialRun={SAMPLE_RUN}
    initialState={posterState({ size: '4x5', signature: '@geekplux' })}
  />
);
Social4x5.storyName = '4 : 5';
Social4x5.meta = { width: 1440 };
