import { useId, useState } from 'react';
import type { Ref } from 'react';
import { ElevationProfile, Slider, StatGrid, StatTile } from '../../components';
import {
  formatDateLine,
  formatDistance,
  formatDuration,
  formatElevation,
  formatKmRange,
} from '../../lib/format';
import type { Units } from '../../lib/format';
import { PageShell } from '../PageShell/PageShell';
import { EXAGGERATION } from '../state';
import type { Run } from '../types';
import sampleTerrain from '../UploadState/sample-terrain.svg';
import { TerrainBox } from './TerrainBox';
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery';
import {
  defaultScrub,
  elevationRangeText,
  exaggerationText,
  readoutParts,
  summitText,
  terrainLabel,
} from './viewCopy';
import type { PaceAt } from './viewCopy';
import styles from './ViewState.module.css';

export interface ViewStateProps {
  run: Run;
  /** Display units (the header's km / mi). */
  units: Units;
  /** Vertical exaggeration, 1–3 (the `exaggeration` pref). */
  exaggeration: number;
  onExaggerationChange: (value: number) => void;
  /** The route-name h1; the page focuses it when the View opens (DECISIONS "Focus"). */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Pace at a distance, seconds per km. PHASE 3 supplies it from timestamps; omitted until then. */
  paceAt?: PaceAt;
}

const noPace: PaceAt = () => null;
const formatExaggeration = (value: number) => `${value.toFixed(1)}×`;

/**
 * The View state (DESIGN-SPEC §3 "02 View", canvas Main frame). Aside: date line, route name,
 * stats, climbs, exaggeration and help. Main: the terrain box (phase 2: the sample illustration)
 * and the elevation profile with its header and scrub readout.
 */
export function ViewState({
  run,
  units,
  exaggeration,
  onExaggerationChange,
  headingRef,
  paceAt = noPace,
}: ViewStateProps) {
  const climbsId = useId();
  const elevationId = useId();
  // Local to the View; the page keys this component by run, so a new run starts fresh.
  const [scrub, setScrub] = useState(() => defaultScrub(run));
  const [flat, setFlat] = useState(false);
  const phone = useMediaQuery(PHONE_QUERY);

  const distance = formatDistance(run.distance, units);
  const vert = formatElevation(run.vert, units, { signed: true });
  const highPoint = formatElevation(run.highPoint, units);

  const aside = (
    <>
      <div className={styles.titleBlock}>
        {/* Wraps between its parts only, never inside the date or the tag. */}
        <p className={styles.dateLine}>
          <span className={styles.nowrap}>
            {formatDateLine(new Date(run.startTime), run.lonForOffset)}
            {run.isSample ? ' ·' : null}
          </span>
          {run.isSample ? (
            <>
              {' '}
              <span className={[styles.nowrap, styles.sample].join(' ')}>SAMPLE DATA</span>
            </>
          ) : null}
        </p>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {run.name}
        </h1>
      </div>

      <StatGrid>
        <StatTile
          label="Distance"
          value={run.distance}
          unit={distance.unit}
          format={() => distance.value}
        />
        <StatTile
          label="Vert"
          value={run.vert}
          unit={vert.unit}
          format={() => vert.value}
          emphasis
        />
        <StatTile label="Moving time" value={run.movingTime} format={formatDuration} />
        <StatTile
          label="High point"
          value={run.highPoint}
          unit={highPoint.unit}
          format={() => highPoint.value}
        />
      </StatGrid>

      <section className={styles.climbs} aria-labelledby={climbsId}>
        <h2 id={climbsId} className={styles.climbsLabel}>
          Climbs
        </h2>
        {run.climbs.length === 0 ? (
          <p className={styles.noClimbs}>No sustained climbs.</p>
        ) : (
          <ol className={styles.climbList}>
            {run.climbs.map((climb, index) => (
              <li
                key={`${String(climb.start)}-${String(climb.end)}`}
                className={climb.steepest ? styles.steepest : styles.climb}
              >
                <span className={styles.climbIndex}>{index + 1}</span>
                <span className={styles.climbRange}>
                  {formatKmRange(climb.start, climb.end, units)}
                  {climb.steepest ? ' · steepest' : null}
                </span>
                <span className={styles.climbGain}>
                  {formatElevation(climb.gain, units, { signed: true }).text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Slider
        label="Vertical exaggeration"
        min={EXAGGERATION.min}
        max={EXAGGERATION.max}
        step={EXAGGERATION.step}
        value={exaggeration}
        format={formatExaggeration}
        onChange={onExaggerationChange}
      />

      <p className={styles.help}>
        Drag the terrain to orbit. Scrub the profile to move the runner along the route. Your file
        stays in this browser.
      </p>
    </>
  );

  return (
    <PageShell asideLabel="Run details" asideWidth="view" aside={aside}>
      <TerrainBox
        summit={summitText(run, units)}
        exaggeration={exaggerationText(exaggeration)}
        flat={flat}
        onRotate={() => undefined /* PHASE 3: TerrainView turns the camera. */}
        onToggleFlat={() => {
          setFlat((on) => !on);
        }}
      >
        {/* PHASE 3: TerrainView replaces this illustration. */}
        <img className={styles.terrainImage} src={sampleTerrain} alt={terrainLabel(run, units)} />
      </TerrainBox>

      <section className={styles.elevation} aria-labelledby={elevationId}>
        <div className={styles.elevationHeader}>
          <h2 id={elevationId} className={styles.elevationLabel}>
            <span className={styles.upper}>Elevation</span> · {elevationRangeText(run, units)}
          </h2>
          <p className={styles.readout}>
            {readoutParts(run.profile, scrub, units, paceAt).join(' · ')}
          </p>
        </div>
        <ElevationProfile
          points={run.profile}
          climbs={run.climbs}
          units={units}
          scrub={scrub}
          onScrub={setScrub}
          height={phone ? 100 : 140}
          valueText={(d) => readoutParts(run.profile, d, units, paceAt).join(', ')}
        />
      </section>
    </PageShell>
  );
}
