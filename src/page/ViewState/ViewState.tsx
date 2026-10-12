import { useId, useState } from 'react';
import type { Ref } from 'react';
import { ElevationProfile, Slider, StatGrid, StatTile } from '../../components';
import { formatDistance, formatDuration, formatElevation, formatKmRange } from '../../lib/format';
import type { Units } from '../../lib/format';
import type { ViewCamera } from '../../terrain/camera';
import { PageShell } from '../PageShell/PageShell';
import { runDateLine, runPaceAt } from '../runCopy';
import { EXAGGERATION } from '../state';
import type { Run, Terrain } from '../types';
import { TerrainBox } from './TerrainBox';
import type { TerrainCameraSource } from './TerrainBox';
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery';
import { TITLE_PX, useTitleFit } from './useTitleFit';
import {
  defaultScrub,
  elevationRangeText,
  elevationSourceText,
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
  /** The terrain under the run (`useTerrain()`): loading, ready or an error. */
  terrain: Terrain;
  /** Builds the terrain again after an error (`useRetryTerrain()`). */
  onRetryTerrain: () => void;
  /** The route-name h1; the page focuses it when the View opens (DECISIONS "Focus"). */
  headingRef?: Ref<HTMLHeadingElement>;
  /**
   * Pace at a distance, seconds per km. Defaults to the run's own timestamps (`runPaceAt`), so a
   * timed run shows "· 6:48 /km" in the readout and a timeless one leaves pace out.
   */
  paceAt?: PaceAt;
  /** Reads the terrain's camera ("Make a poster" hands it to Poster mode); see `TerrainBox`. */
  cameraRef?: Ref<TerrainCameraSource>;
  /**
   * The camera to start from, flat or oblique, with no intro: the poster's, back from Poster
   * mode, so the next "Make a poster" keeps the user's angle. Default: the intro.
   */
  initialCamera?: ViewCamera;
}
const formatExaggeration = (value: number) => `${value.toFixed(1)}×`;
/** Spoken: screen readers drop or misread "×" ("1.6" or "1.6 multiplication sign"). */
const exaggerationValueText = (value: number) => `${value.toFixed(1)} times`;

/**
 * The View state (DESIGN-SPEC §3 "02 View", canvas Main frame). Aside: date line, route name,
 * stats, climbs, exaggeration and help. Main: the terrain box (the live `TerrainView`, legend,
 * Rotate / Flat map) and the elevation profile with its header and scrub readout. The scrub is one
 * value: dragging or keying the profile moves the marker on the terrain too.
 */
export function ViewState({
  run,
  units,
  exaggeration,
  onExaggerationChange,
  terrain,
  onRetryTerrain,
  headingRef,
  paceAt: paceAtProp,
  cameraRef,
  initialCamera,
}: ViewStateProps) {
  const paceAt: PaceAt = paceAtProp ?? ((d) => runPaceAt(run, d));
  const climbsId = useId();
  const elevationId = useId();
  // Local to the View; the page keys this component by run, so a new run starts fresh.
  const [scrub, setScrub] = useState(() => defaultScrub(run));
  const [flat, setFlat] = useState(() => initialCamera?.view === 'flat');
  const phone = useMediaQuery(PHONE_QUERY);
  const [titleRef, titleFit] = useTitleFit(run.name, headingRef);

  const distance = formatDistance(run.distance, units);
  const vert = formatElevation(run.vert, units, { signed: true });
  const highPoint = formatElevation(run.highPoint, units);
  // Empty for a file without timestamps: the line then shows only the SAMPLE DATA tag, or nothing.
  const dateLine = runDateLine(run);

  // A file without <ele>: say where the elevations come from (or why they are missing).
  const sourceNote = elevationSourceText(run, terrain.status);
  const statGrid = (
    <StatGrid>
      <StatTile
        label="Distance"
        value={run.distance}
        unit={distance.unit}
        format={() => distance.value}
      />
      <StatTile label="Vert" value={run.vert} unit={vert.unit} format={() => vert.value} emphasis />
      <StatTile label="Moving time" value={run.movingTime} format={formatDuration} />
      <StatTile
        label="High point"
        value={run.highPoint}
        unit={highPoint.unit}
        format={() => highPoint.value}
      />
    </StatGrid>
  );

  const aside = (
    <>
      <div className={styles.titleBlock}>
        {/* Wraps between its parts only, never inside the date or the tag. */}
        {dateLine || run.isSample ? (
          <p className={styles.dateLine}>
            {dateLine ? (
              <span className={styles.nowrap}>
                {dateLine}
                {run.isSample ? ' ·' : null}
              </span>
            ) : null}
            {dateLine && run.isSample ? ' ' : null}
            {run.isSample ? (
              <span className={[styles.nowrap, styles.sample].join(' ')}>SAMPLE DATA</span>
            ) : null}
          </p>
        ) : null}
        {/* A word wider than the column steps the size down (useTitleFit), and only below
            TITLE_MIN_PX may it hyphenate or break; other titles are set as the canvas draws them. */}
        <h1
          ref={titleRef}
          tabIndex={-1}
          className={[styles.title, titleFit.breakWords && styles.breakWords]
            .filter(Boolean)
            .join(' ')}
          style={titleFit.size === TITLE_PX ? undefined : { fontSize: titleFit.size }}
        >
          {run.name}
        </h1>
      </div>

      {sourceNote ? (
        <div className={styles.statsBlock}>
          {statGrid}
          <p className={styles.elevationSource} role="status">
            {sourceNote}
          </p>
        </div>
      ) : (
        statGrid
      )}

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
                  {/* The range breaks only after its arrow ("km 154.6 →" / "168.5"), never
                      into the gain; "steepest" is a tag that wraps as a whole, under the range
                      when the column is narrow (never a lone "·"). */}
                  <ClimbRange text={formatKmRange(climb.start, climb.end, units)} />
                  {climb.steepest ? (
                    <>
                      {' '}
                      <span className={styles.steepestTag}>
                        <span className={styles.visuallyHidden}>· </span>steepest
                      </span>
                    </>
                  ) : null}
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
        valueText={exaggerationValueText}
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
        terrain={terrain}
        onRetry={onRetryTerrain}
        track={run.track}
        scrub={scrub}
        exaggeration={exaggeration}
        ariaLabel={terrainLabel(run, units)}
        summit={summitText(run, units)}
        exaggerationLabel={exaggerationText(exaggeration)}
        flat={flat}
        initialCamera={initialCamera}
        onToggleFlat={() => {
          setFlat((on) => !on);
        }}
        overlaysBelow={phone}
        cameraRef={cameraRef}
      />

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

/** A climb's range, "km 5.6 → 8.4", that may break after the arrow and nowhere else. */
function ClimbRange({ text }: { text: string }) {
  const arrow = text.indexOf(' → ');
  if (arrow < 0) return <span className={styles.nowrap}>{text}</span>;
  return (
    <>
      <span className={styles.nowrap}>{text.slice(0, arrow + 2)}</span>{' '}
      <span className={styles.nowrap}>{text.slice(arrow + 3)}</span>
    </>
  );
}
