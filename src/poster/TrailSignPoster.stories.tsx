import type { Story } from '@ladle/react';
import type { ReactNode } from 'react';
import sampleTerrain from '../page/UploadState/sample-terrain.svg';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { PosterPreview } from './PosterPreview';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { TrailSignPoster } from './TrailSignPoster';
import { posterContentFromRun } from './types';
import type { PosterContent } from './types';

// Each poster story renders unscaled at its logical size (720 wide for print, 1080 for social), so
// it can be compared with the canvas frames pixel for pixel. "Preview" shows the scaled preview.
export default { title: 'Poster / Trail Sign' };

const ALL_STATS = { distance: true, vert: true, time: true, highPoint: true };

function content(poster: Partial<PosterPrefs> = {}) {
  return posterContentFromRun(SAMPLE_RUN, {
    ...INITIAL_PREFS,
    poster: { ...INITIAL_PREFS.poster, stats: ALL_STATS, ...poster },
  });
}

const figure = <img src={sampleTerrain} alt="" />;

function Poster({ size, poster }: { size: PosterSizeId; poster?: Partial<PosterPrefs> }) {
  return <TrailSignPoster content={content(poster)} size={posterSizeById(size)} figure={figure} />;
}

export const Print18x24: Story = () => <Poster size="18x24" />;
Print18x24.storyName = '18 x 24';

export const A3: Story = () => <Poster size="a3" />;
A3.storyName = 'A3';

export const Social4x5: Story = () => <Poster size="4x5" poster={{ signature: '@geekplux' }} />;
Social4x5.storyName = '4 : 5';

export const Story9x16: Story = () => <Poster size="9x16" poster={{ signature: '@geekplux' }} />;
Story9x16.storyName = '9 : 16';

export const LongTitle: Story = () => (
  <Poster
    size="18x24"
    poster={{ title: 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop' }}
  />
);
LongTitle.storyName = 'Long title';

export const ShortTitle: Story = () => <Poster size="18x24" poster={{ title: 'UTMB' }} />;
ShortTitle.storyName = 'Short title';

export const CjkTitle: Story = () => (
  <Poster size="18x24" poster={{ title: '高尾山から陣馬山への縦走トレイルランニング大会コース' }} />
);
CjkTitle.storyName = 'CJK title';

export const TwoStats: Story = () => (
  <Poster
    size="18x24"
    poster={{ stats: { distance: true, vert: true, time: false, highPoint: false } }}
  />
);
TwoStats.storyName = 'Two stats only';

export const WithSubtitle: Story = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
    <Poster
      size="18x24"
      poster={{ subtitle: 'Vogel State Park, Georgia', signature: '@geekplux' }}
    />
    <Poster size="4x5" poster={{ subtitle: 'Vogel State Park, Georgia', signature: '@geekplux' }} />
  </div>
);
WithSubtitle.storyName = 'With subtitle';

const LONG_SUBTITLE =
  'Vogel State Park, Blood Mountain Wilderness, Chattahoochee-Oconee National Forest, Georgia';

export const LongSubtitle: Story = () => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
    <Poster size="18x24" poster={{ subtitle: LONG_SUBTITLE, signature: '@geekplux' }} />
    <Poster size="4x5" poster={{ subtitle: LONG_SUBTITLE, signature: '@geekplux' }} />
  </div>
);
LongSubtitle.storyName = 'Long subtitle';

const HP_ONLY = { distance: false, vert: false, time: false, highPoint: true };
const NO_STATS = { distance: false, vert: false, time: false, highPoint: false };
// 80 characters typed; posterContentFromRun cuts it to 40 with an ellipsis.
const LONG_SIGNATURE = `@${'mountain-trail-'.repeat(6)}`.slice(0, 80);

function Pair({ a, b }: { a: ReactNode; b: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {a}
      {b}
    </div>
  );
}

export const HighPointOnly: Story = () => (
  <Pair
    a={<Poster size="4x5" poster={{ stats: HP_ONLY, signature: '@geekplux' }} />}
    b={<Poster size="9x16" poster={{ stats: HP_ONLY, signature: '@geekplux' }} />}
  />
);
HighPointOnly.storyName = 'High point only';

export const NoStats: Story = () => (
  <Pair
    a={<Poster size="4x5" poster={{ stats: NO_STATS, signature: '@geekplux' }} />}
    b={<Poster size="9x16" poster={{ stats: NO_STATS, signature: '@geekplux' }} />}
  />
);
NoStats.storyName = 'No stats';

export const LongSignature: Story = () => (
  <Pair
    a={<Poster size="18x24" poster={{ signature: LONG_SIGNATURE, subtitle: 'Vogel State Park' }} />}
    b={<Poster size="4x5" poster={{ signature: LONG_SIGNATURE }} />}
  />
);
LongSignature.storyName = 'Long signature';

export const Preview: Story = () => (
  <div style={{ padding: 32 }}>
    <PosterPreview size={posterSizeById('18x24')}>
      <TrailSignPoster
        content={posterContentFromRun(SAMPLE_RUN, INITIAL_PREFS)}
        size={posterSizeById('18x24')}
        figure={figure}
      />
    </PosterPreview>
  </div>
);
Preview.storyName = 'Preview 600 x 800';

// The canvas frames' placeholder copy, for comparing geometry with docs/design/canvas/Poster.html
// and Share.html (docs/verify/poster-a-impl/).
const CANVAS_COPY: PosterContent = {
  ...content(),
  title: '[Route name] Loop',
  subtitle: '',
  date: '[DATE]',
  stats: {
    distance: { value: '21.4', unit: 'km', text: '21.4 km' },
    vert: { value: '+1,070', unit: 'm', text: '+1,070 m' },
    time: '3:12:40',
    highPoint: { value: '820', unit: 'm', text: '820 m' },
  },
};

export const CanvasCopy18x24: Story = () => (
  <TrailSignPoster content={CANVAS_COPY} size={posterSizeById('18x24')} figure={figure} />
);
CanvasCopy18x24.storyName = 'Canvas copy 18 x 24';

export const CanvasCopy4x5: Story = () => (
  <TrailSignPoster
    content={{ ...CANVAS_COPY, title: '[Route name]', signature: '@geekplux', isSample: false }}
    size={posterSizeById('4x5')}
    figure={figure}
  />
);
CanvasCopy4x5.storyName = 'Canvas copy 4 : 5';
