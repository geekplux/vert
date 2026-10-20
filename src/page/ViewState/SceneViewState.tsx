import { useEffect, useMemo, useState } from 'react';
import type { Ref } from 'react';
import { StatGrid, StatTile } from '../../components';
import { SceneElevationProfile } from '../../components/ElevationProfile/SceneElevationProfile';
import { sceneProfile } from '../../components/ElevationProfile/sceneProfile';
import { formatDistance, formatElevation } from '../../lib/format';
import type { Units } from '../../lib/format';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import type { LinkedScene } from '../hooks';
import { PageShell } from '../PageShell/PageShell';
import {
  defaultSceneScrub,
  sceneElevationRange,
  sceneElevationRangeText,
  sceneLine,
  scenePaceAt,
  sceneSummitText,
  sceneTerrainLabel,
  sceneTrimText,
} from './sceneCopy';
import { TerrainBox } from './TerrainBox';
import type { TerrainCameraSource } from './TerrainBox';
import { exaggerationText, readoutParts } from './viewCopy';
import { ClimbList, ElevationSection, ExaggerationSlider, ViewTitle } from './ViewState';
import styles from './ViewState.module.css';

export interface SceneViewStateProps {
  /** The scene opened from the link (`useScene()`). */
  linked: LinkedScene;
  units: Units;
  exaggeration: number;
  onExaggerationChange: (value: number) => void;
  /** The h1 (the scene's name); the page focuses it when the View opens. */
  headingRef?: Ref<HTMLHeadingElement>;
  cameraRef?: Ref<TerrainCameraSource>;
}

/**
 * The View state for a baked scene opened from a link (`?scene=`, DECISIONS "Page: open a scene by
 * URL"): the same layout, terrain box and profile as a run's View, fed from what the scene holds.
 *
 * - The mono line says where it came from ("SCENE · ACTIVITIES.GEEKPLUX.ORG"); the h1 is the
 *   link's `&title=`, else the file name (the format carries no title).
 * - Stats: the whole run's Distance and Vert (the scene's summary), the Drawn length and the drawn
 *   route's High point; a scene has no moving time. A line under them says which ends are hidden.
 * - Climbs, exaggeration, the terrain (Rotate, Flat map), the profile, its readout (with pace when
 *   the scene has times) and the scrub, as for a run.
 * - No poster: the poster styles need the run's coordinates (their maps, tiles, sunrise and date),
 *   which a scene leaves out on purpose. The help line says to drop a GPX for one.
 */
export function SceneViewState({
  linked,
  units,
  exaggeration,
  onExaggerationChange,
  headingRef,
  cameraRef,
}: SceneViewStateProps) {
  const { scene, name, host, titled } = linked;
  // A link's `&title=` also names the tab while the scene is shown ("Translantau 50 · Vert").
  useEffect(() => {
    if (!titled) return undefined;
    const previous = document.title;
    document.title = `${name} · Vert`;
    return () => {
      document.title = previous;
    };
  }, [name, titled]);
  const profile = useMemo(() => sceneProfile(scene), [scene]);
  const { high } = useMemo(() => sceneElevationRange(scene), [scene]);
  // Local to the View; the page keys this component by scene, so a new one starts fresh.
  const [scrub, setScrub] = useState(() => defaultSceneScrub(scene));
  const [flat, setFlat] = useState(false);
  const phone = useMediaQuery(PHONE_QUERY);

  const paceAt = (d: number) => scenePaceAt(scene, d);
  const distance = formatDistance(scene.summary.distance, units);
  const vert = formatElevation(scene.summary.climb, units, { signed: true });
  const drawn = formatDistance(scene.summary.drawnLength, units);
  const highPoint = formatElevation(high, units);
  const trimNote = sceneTrimText(scene, units);

  const statGrid = (
    <StatGrid>
      <StatTile
        label="Distance"
        value={scene.summary.distance}
        unit={distance.unit}
        format={() => distance.value}
      />
      <StatTile
        label="Vert"
        value={scene.summary.climb}
        unit={vert.unit}
        format={() => vert.value}
        emphasis
      />
      <StatTile
        label="Drawn"
        value={scene.summary.drawnLength}
        unit={drawn.unit}
        format={() => drawn.value}
      />
      <StatTile
        label="High point"
        value={high}
        unit={highPoint.unit}
        format={() => highPoint.value}
      />
    </StatGrid>
  );

  const aside = (
    <>
      <ViewTitle line={sceneLine(host)} name={name} headingRef={headingRef} />

      {trimNote ? (
        <div className={styles.statsBlock}>
          {statGrid}
          <p className={styles.elevationSource}>{trimNote}</p>
        </div>
      ) : (
        statGrid
      )}

      <ClimbList climbs={scene.climbs} units={units} />

      <ExaggerationSlider value={exaggeration} onChange={onExaggerationChange} />

      <p className={styles.help}>
        Drag the terrain to orbit. Scrub the profile to move the runner along the route. To make a
        poster, drop a GPX file of your own run.
      </p>
    </>
  );

  return (
    <PageShell asideLabel="Run details" asideWidth="view" aside={aside}>
      <TerrainBox
        scene={scene}
        scrub={scrub}
        exaggeration={exaggeration}
        ariaLabel={sceneTerrainLabel(scene, name, units)}
        summit={sceneSummitText(scene, units)}
        exaggerationLabel={exaggerationText(exaggeration)}
        flat={flat}
        onToggleFlat={() => {
          setFlat((on) => !on);
        }}
        overlaysBelow={phone}
        cameraRef={cameraRef}
      />

      <ElevationSection
        range={sceneElevationRangeText(scene, units)}
        readout={readoutParts(profile.points, scrub, units, paceAt).join(' · ')}
      >
        <SceneElevationProfile
          scene={scene}
          units={units}
          scrub={scrub}
          onScrub={setScrub}
          height={phone ? 100 : 140}
          valueText={(d) => readoutParts(profile.points, d, units, paceAt).join(', ')}
        />
      </ElevationSection>
    </PageShell>
  );
}
