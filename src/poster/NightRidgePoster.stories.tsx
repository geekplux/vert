import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import type { Units } from '../lib/format';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import type { Run } from '../page/types';
import { NIGHT_RIDGE_ROWS, nightRidgeFigureData, ridgeBounds } from './figures';
import { posterLayout } from './layout';
import { NightRidgePoster } from './NightRidgePoster';
import type { NightRidgeBox } from './NightRidgePoster';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { useHeightfield, useSampleRun } from './storyData';

import { posterContentFromRun } from './types';

// Each story renders unscaled at its logical size (720 wide for print, 1080 for social) with the
// real sample run (public/samples). Once the stage is laid out, a heightfield is built through the
// /tiles proxy for the route's bounds widened for the stage (`ridgeBounds`). `data-ready` turns
// true once the ridges are drawn (for the verification scripts).
export default { title: 'Poster / Night Ridge' };

const ALL_STATS = { distance: true, vert: true, time: true, highPoint: true };

interface PosterProps {
  size: PosterSizeId;
  poster?: Partial<PosterPrefs>;
  /** Changes the loaded run (e.g. drop its timestamps). */
  edit?: (run: Run) => Run;
  units?: Units;
  /** Build the figure at the export scale (print detail) instead of the preview's. */
  exportDetail?: boolean;
}

function Poster({ size, poster, edit, units = 'metric', exportDetail = false }: PosterProps) {
  const loaded = useSampleRun();
  const run = useMemo(() => (loaded && edit ? edit(loaded) : loaded), [loaded, edit]);
  const [box, setBox] = useState<NightRidgeBox | null>(null);
  // The stage and the text's bottom to 10 px, so a small relayout does not rebuild the heightfield.
  const round = (v: number) => Math.round(v / 10) * 10;
  const stageW = box ? round(box.width) : 0;
  const stageH = box ? round(box.height) : 0;
  const textBottom = box ? round(Math.max(0, ...box.keepOut.map((r) => r.y + r.height))) : 0;
  const bounds = useMemo(
    () =>
      run && stageW > 0
        ? ridgeBounds(run.bounds, {
            width: stageW,
            height: stageH,
            keepOut: [{ x: 0, y: 0, width: 1, height: textBottom }],
          })
        : null,
    [run, stageW, stageH, textBottom],
  );
  const heightfield = useHeightfield(bounds, { padding: 0 });
  const posterSize = posterSizeById(size);
  const kind = posterLayout(posterSize).kind;
  const detailScale = exportDetail ? posterLayout(posterSize).scale : 1;
  const prefs = {
    ...INITIAL_PREFS,
    units,
    poster: { ...INITIAL_PREFS.poster, stats: ALL_STATS, ...poster },
  };
  const content = posterContentFromRun(run ?? SAMPLE_RUN, prefs);
  const data = useMemo(
    () =>
      run
        ? nightRidgeFigureData(run, heightfield, box, {
            exaggeration: prefs.exaggeration,
            rows: NIGHT_RIDGE_ROWS[kind],
            detailScale,
          })
        : null,
    [run, heightfield, box, prefs.exaggeration, kind, detailScale],
  );
  return (
    <div data-ready={data?.ridges ? 'true' : 'false'} style={{ display: 'inline-block' }}>
      <NightRidgePoster
        content={content}
        size={posterSize}
        figureData={data}
        onFigureBox={setBox}
        figure={<span />}
      />
    </div>
  );
}

export const Print18x24: Story = () => <Poster size="18x24" />;
Print18x24.storyName = '18 x 24';

export const A3: Story = () => <Poster size="a3" />;
A3.storyName = 'A3';

export const Social4x5: Story = () => <Poster size="4x5" poster={{ signature: '@geekplux' }} />;
Social4x5.storyName = '4 : 5';

export const Story9x16: Story = () => <Poster size="9x16" poster={{ signature: '@geekplux' }} />;
Story9x16.storyName = '9 : 16';

const withoutTimes = (run: Run): Run => ({
  ...run,
  hasTime: false,
  movingTime: NaN,
  elapsedTime: NaN,
  track: { ...run.track, time: null },
});

export const NoTimestamps: Story = () => <Poster size="18x24" edit={withoutTimes} />;
NoTimestamps.storyName = 'No timestamps (no sunrise)';

export const LongTitle: Story = () => (
  <Poster
    size="18x24"
    poster={{
      title: 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop',
      subtitle: 'Vogel State Park',
    }}
  />
);
LongTitle.storyName = 'Long title';

export const Imperial: Story = () => <Poster size="4x5" units="imperial" />;
Imperial.storyName = 'Imperial units';

export const ExportDetail: Story = () => <Poster size="18x24" exportDetail />;
ExportDetail.storyName = '18 x 24 at export detail';
