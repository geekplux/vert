import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import type { Units } from '../lib/format';
import { SAMPLE_RUN } from '../page/sample';
import { INITIAL_PREFS } from '../page/state';
import type { PosterPrefs } from '../page/state';
import { quadBounds, surveyQuadFigureData } from './figures';
import { posterLayout } from './layout';
import { posterSizeById } from './sizes';
import type { PosterSizeId } from './sizes';
import { useHeightfield, useSampleRun } from './storyData';
import { SurveyQuadPoster } from './SurveyQuadPoster';
import type { FigureBoxSize } from './TrailSignPoster';
import { posterContentFromRun } from './types';

// Each story renders unscaled at its logical size (720 wide for print, 1080 for social) with the
// real sample run. Once the map box is laid out, a heightfield is built through the /tiles proxy
// for the route's bounds widened to the box's aspect (`quadBounds`), so the map fills its frame.
// `data-ready` turns true once the contours are drawn (for the verification scripts).
export default { title: 'Poster / Survey Quad' };

const ALL_STATS = { distance: true, vert: true, time: true, highPoint: true };

interface PosterProps {
  size: PosterSizeId;
  poster?: Partial<PosterPrefs>;
  units?: Units;
  /** Build the figure at the export scale (print detail) instead of the preview's. */
  exportDetail?: boolean;
}

function Poster({ size, poster, units = 'metric', exportDetail = false }: PosterProps) {
  const run = useSampleRun();
  const [box, setBox] = useState<FigureBoxSize | null>(null);
  // The aspect to two decimals, so a sub-pixel relayout does not rebuild the heightfield.
  const aspect = box ? Math.round((box.width / box.height) * 100) / 100 : null;
  const bounds = useMemo(
    () => (run && aspect ? quadBounds(run.bounds, aspect) : null),
    [run, aspect],
  );
  const heightfield = useHeightfield(bounds, { padding: 0 });
  const posterSize = posterSizeById(size);
  const layout = posterLayout(posterSize).kind;
  const detailScale = exportDetail ? posterLayout(posterSize).scale : 1;
  const prefs = {
    ...INITIAL_PREFS,
    units,
    poster: { ...INITIAL_PREFS.poster, stats: ALL_STATS, ...poster },
  };
  const content = posterContentFromRun(run ?? SAMPLE_RUN, prefs);
  const data = useMemo(
    () =>
      run ? surveyQuadFigureData(run, heightfield, box, { units, layout, detailScale }) : null,
    [run, heightfield, box, units, layout, detailScale],
  );
  return (
    <div data-ready={data?.map ? 'true' : 'false'} style={{ display: 'inline-block' }}>
      <SurveyQuadPoster
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

export const LongTitle: Story = () => (
  <Poster
    size="18x24"
    poster={{
      title: 'Chattahoochee National Forest Backcountry Ridge Traverse and Return Loop',
      subtitle: 'Vogel State Park, Georgia',
    }}
  />
);
LongTitle.storyName = 'Long title';

export const Imperial: Story = () => <Poster size="4x5" units="imperial" />;
Imperial.storyName = 'Imperial units';

export const ExportDetail: Story = () => <Poster size="18x24" exportDetail />;
ExportDetail.storyName = '18 x 24 at export detail';
