/**
 * The page's one state machine (DESIGN-SPEC §3): which screen is showing, plus the UI preferences
 * that outlive a screen.
 *
 * Shape: `PageState = { screen, prefs }`, driven by one pure `pageReducer` behind one `useReducer`
 * (`usePageState`). Inside, two sibling reducers do the work: `screenReducer` (the four states and
 * their transitions) and `prefsReducer` (units, exaggeration, poster settings). They share one
 * dispatch so that the two cross-cutting rules happen atomically in the same update:
 *
 * - `RUN_LOADED` may carry `posterText` (title and subtitle from the run) to seed the poster.
 * - `MAKE_POSTER` may carry the View's terrain camera, which the poster's figure then uses.
 * - `NEW_FILE` resets the poster's title, subtitle and camera, which belong to the old run.
 *   Everything else persists until reload: units, exaggeration, poster style, size, which stats show, hide
 *   ends, and the signature (it describes the author, not the run).
 *
 * Screens and transitions:
 *
 *   upload ──FILE_CHOSEN / SAMPLE_CHOSEN──▶ upload (busy) ──RUN_LOADED──▶ view
 *   upload (busy) ──LOAD_FAILED──▶ upload (error)
 *   view ──MAKE_POSTER──▶ poster ──BACK_TO_RUN──▶ view
 *   view, poster ──NEW_FILE──▶ upload
 *   poster ──EXPORT_STARTED──▶ exporting (total unknown: "Preparing…")
 *   exporting ──EXPORT_PROGRESS { done, total }──▶ exporting (the exporter owns the tile count)
 *   exporting ──EXPORT_DONE──▶ poster (with "Saved <file>") │ ──EXPORT_FAILED──▶ poster (with
 *   the error) │ ──EXPORT_CANCELLED──▶ poster
 *
 * `exporting` is an overlay on poster mode: the page keeps showing the poster screen and adds the
 * progress bar (`isPosterMode`). Any other event in a screen is ignored (the state is returned
 * unchanged). `ScreenEvent<'view'>` etc. type the events a screen accepts, so a screen's component
 * can be handed a dispatch that cannot send an invalid one.
 */
import { useReducer } from 'react';
import type { Dispatch } from 'react';
import type { Units } from '../lib/format';
import { DEFAULT_VIEW_CAMERA } from '../terrain/camera';
import type { ViewCamera } from '../terrain/camera';
import type { PosterSizeId } from '../poster/sizes';
import type { PosterStyleId } from '../poster/styles';
import type { Run } from './types';

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

/** What the Upload screen is doing. */
export type UploadBusy =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly fileName: string }
  | { readonly kind: 'sample' };

export interface UploadScreen {
  readonly name: 'upload';
  readonly busy: UploadBusy;
  /** Why the last file could not be loaded; cleared when another file or the sample is chosen. */
  readonly error: string | null;
}

export interface ViewScreen {
  readonly name: 'view';
  readonly runId: string;
}

/** How the last export ended, shown under the Download button until the next export. */
export type PosterNotice =
  | { readonly kind: 'saved'; readonly fileName: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface PosterScreen {
  readonly name: 'poster';
  readonly runId: string;
  /** Set when an export ends ("Saved <file>" or the error); cleared by the next export. */
  readonly notice: PosterNotice | null;
}

/** Poster mode with the export overlay on top. */
export interface ExportingScreen {
  readonly name: 'exporting';
  readonly runId: string;
  /** The file being written, e.g. "coosa-backcountry-loop-18x24.png". */
  readonly fileName: string;
  /**
   * Tiles rendered so far out of the total ("Rendering tile 4 of 12"); 0 ≤ done ≤ total. `total`
   * is null until the exporter reports it ("Preparing…"). `stage: 'encode'` once every tile is
   * drawn and the file is being written ("Saving the file…").
   */
  readonly progress: {
    readonly done: number;
    readonly total: number | null;
    readonly stage?: 'encode';
  };
}

export type Screen = UploadScreen | ViewScreen | PosterScreen | ExportingScreen;
export type ScreenName = Screen['name'];

/** Poster mode shows for both `poster` and `exporting`. */
export function isPosterMode(screen: Screen): screen is PosterScreen | ExportingScreen {
  return screen.name === 'poster' || screen.name === 'exporting';
}

// ---------------------------------------------------------------------------------------------
// Screen events
// ---------------------------------------------------------------------------------------------

/** Title and subtitle to seed the poster with when a run loads (see `posterTextFor`). */
export interface PosterText {
  readonly title: string;
  readonly subtitle: string;
}

export interface FileChosen {
  readonly type: 'FILE_CHOSEN';
  readonly fileName: string;
}
export interface SampleChosen {
  readonly type: 'SAMPLE_CHOSEN';
}
export interface RunLoaded {
  readonly type: 'RUN_LOADED';
  readonly runId: string;
  readonly posterText?: PosterText;
}
export interface LoadFailed {
  readonly type: 'LOAD_FAILED';
  readonly message: string;
}
export interface NewFile {
  readonly type: 'NEW_FILE';
}
export interface MakePoster {
  readonly type: 'MAKE_POSTER';
  /**
   * The View's terrain camera as the user left it (`TerrainViewHandle.camera()`): the poster's
   * terrain figure uses it (BRIEF "Make a poster uses the current camera"). Missing (no terrain
   * drawn yet) keeps the poster's camera as it was.
   */
  readonly camera?: ViewCamera;
}
export interface BackToRun {
  readonly type: 'BACK_TO_RUN';
}
export interface ExportStarted {
  readonly type: 'EXPORT_STARTED';
  readonly fileName: string;
}
/**
 * From the exporter: tiles done out of `total` (an integer ≥ 1; it may change between reports);
 * `stage: 'encode'` while the file is written (every tile done).
 */
export interface ExportProgress {
  readonly type: 'EXPORT_PROGRESS';
  readonly done: number;
  readonly total: number;
  readonly stage?: 'encode';
}
export interface ExportCancelled {
  readonly type: 'EXPORT_CANCELLED';
}
export interface ExportDone {
  readonly type: 'EXPORT_DONE';
  readonly fileName: string;
}
export interface ExportFailed {
  readonly type: 'EXPORT_FAILED';
  /** Shown to the user under the Download button. */
  readonly message: string;
}

/** The events each screen accepts. Everything else is ignored in that screen. */
export interface ScreenEvents {
  upload: FileChosen | SampleChosen | RunLoaded | LoadFailed;
  view: NewFile | MakePoster;
  poster: NewFile | BackToRun | ExportStarted;
  exporting: ExportProgress | ExportCancelled | ExportDone | ExportFailed;
}

/** Events valid in screen `N` (`ScreenEvent<'view'>`), or in any screen (`ScreenEvent`). */
export type ScreenEvent<N extends ScreenName = ScreenName> = ScreenEvents[N];

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

export type PosterStat = 'distance' | 'vert' | 'time' | 'highPoint';
export type PosterTextField = 'title' | 'subtitle' | 'signature';

export interface PosterPrefs {
  readonly style: PosterStyleId;
  readonly size: PosterSizeId;
  readonly title: string;
  readonly subtitle: string;
  readonly signature: string;
  readonly stats: Readonly<Record<PosterStat, boolean>>;
  /** Metres of route hidden at the start and the end, 0–500 in steps of 100. */
  readonly hideEnds: number;
  /**
   * The terrain camera of style A's figure: the View's camera when "Make a poster" was pressed
   * (`MAKE_POSTER`), the View's default oblique view until then and after New file.
   */
  readonly camera: ViewCamera;
}

export interface Prefs {
  readonly units: Units;
  /** Vertical exaggeration of the terrain, 1–3 in steps of 0.1. */
  readonly exaggeration: number;
  readonly poster: PosterPrefs;
}

export const EXAGGERATION = { min: 1, max: 3, step: 0.1, initial: 1.6 } as const;
export const HIDE_ENDS = { min: 0, max: 500, step: 100, initial: 200 } as const;

export const INITIAL_PREFS: Prefs = {
  units: 'metric',
  exaggeration: EXAGGERATION.initial,
  poster: {
    style: 'A',
    size: '18x24',
    title: '',
    subtitle: '',
    signature: '',
    stats: { distance: true, vert: true, time: true, highPoint: false },
    hideEnds: HIDE_ENDS.initial,
    camera: DEFAULT_VIEW_CAMERA,
  },
};

export type PrefsEvent =
  | { readonly type: 'SET_UNITS'; readonly units: Units }
  | { readonly type: 'SET_EXAGGERATION'; readonly value: number }
  | { readonly type: 'SET_POSTER_STYLE'; readonly style: PosterStyleId }
  | { readonly type: 'SET_POSTER_SIZE'; readonly size: PosterSizeId }
  | { readonly type: 'SET_POSTER_TEXT'; readonly field: PosterTextField; readonly value: string }
  | { readonly type: 'SET_POSTER_STAT'; readonly stat: PosterStat; readonly shown: boolean }
  | { readonly type: 'SET_HIDE_ENDS'; readonly metres: number };

/** Clamp to [min, max] and snap to the step grid. NaN gives `fallback`. */
function snap(
  value: number,
  { min, max, step }: { min: number; max: number; step: number },
  fallback: number,
): number {
  if (Number.isNaN(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  // Round to the step, then to 10 decimals so 1.6 stays 1.6 and not 1.6000000000000003.
  return Number((Math.round((clamped - min) / step) * step + min).toFixed(10));
}

function withPoster(prefs: Prefs, poster: Partial<PosterPrefs>): Prefs {
  return { ...prefs, poster: { ...prefs.poster, ...poster } };
}

export function prefsReducer(prefs: Prefs, event: PrefsEvent): Prefs {
  switch (event.type) {
    case 'SET_UNITS':
      return { ...prefs, units: event.units };
    case 'SET_EXAGGERATION':
      return { ...prefs, exaggeration: snap(event.value, EXAGGERATION, prefs.exaggeration) };
    case 'SET_POSTER_STYLE':
      return withPoster(prefs, { style: event.style });
    case 'SET_POSTER_SIZE':
      return withPoster(prefs, { size: event.size });
    case 'SET_POSTER_TEXT':
      return withPoster(prefs, { [event.field]: event.value });
    case 'SET_POSTER_STAT':
      return withPoster(prefs, { stats: { ...prefs.poster.stats, [event.stat]: event.shown } });
    case 'SET_HIDE_ENDS':
      return withPoster(prefs, { hideEnds: snap(event.metres, HIDE_ENDS, prefs.poster.hideEnds) });
  }
}

// ---------------------------------------------------------------------------------------------
// Screen reducer
// ---------------------------------------------------------------------------------------------

export const INITIAL_SCREEN: UploadScreen = { name: 'upload', busy: { kind: 'idle' }, error: null };

function upload(screen: UploadScreen, event: ScreenEvent): Screen {
  const idle = screen.busy.kind === 'idle';
  switch (event.type) {
    case 'FILE_CHOSEN':
      return idle
        ? { ...screen, busy: { kind: 'reading', fileName: event.fileName }, error: null }
        : screen;
    case 'SAMPLE_CHOSEN':
      return idle ? { ...screen, busy: { kind: 'sample' }, error: null } : screen;
    case 'RUN_LOADED':
      return idle ? screen : { name: 'view', runId: event.runId };
    case 'LOAD_FAILED':
      return { ...screen, busy: { kind: 'idle' }, error: event.message };
    default:
      return screen;
  }
}

function view(screen: ViewScreen, event: ScreenEvent): Screen {
  switch (event.type) {
    case 'NEW_FILE':
      return INITIAL_SCREEN;
    case 'MAKE_POSTER':
      return { name: 'poster', runId: screen.runId, notice: null };
    default:
      return screen;
  }
}

function poster(screen: PosterScreen, event: ScreenEvent): Screen {
  switch (event.type) {
    case 'NEW_FILE':
      return INITIAL_SCREEN;
    case 'BACK_TO_RUN':
      return { name: 'view', runId: screen.runId };
    case 'EXPORT_STARTED':
      return {
        name: 'exporting',
        runId: screen.runId,
        fileName: event.fileName,
        progress: { done: 0, total: null },
      };
    default:
      return screen;
  }
}

function exporting(screen: ExportingScreen, event: ScreenEvent): Screen {
  switch (event.type) {
    case 'EXPORT_PROGRESS': {
      const { total } = event;
      if (Number.isNaN(event.done) || !Number.isInteger(total) || total < 1) return screen;
      const encode = event.stage === 'encode';
      // Encoding comes after every tile.
      const done = encode ? total : Math.min(total, Math.max(0, Math.floor(event.done)));
      const current = screen.progress;
      if (
        done === current.done &&
        total === current.total &&
        encode === (current.stage === 'encode')
      ) {
        return screen;
      }
      return { ...screen, progress: encode ? { done, total, stage: 'encode' } : { done, total } };
    }
    case 'EXPORT_CANCELLED':
      return { name: 'poster', runId: screen.runId, notice: null };
    case 'EXPORT_DONE':
      return {
        name: 'poster',
        runId: screen.runId,
        notice: { kind: 'saved', fileName: event.fileName },
      };
    case 'EXPORT_FAILED':
      return {
        name: 'poster',
        runId: screen.runId,
        notice: { kind: 'failed', message: event.message },
      };
    default:
      return screen;
  }
}

/** The four states and their transitions. Returns `screen` itself when the event is ignored. */
export function screenReducer(screen: Screen, event: ScreenEvent): Screen {
  switch (screen.name) {
    case 'upload':
      return upload(screen, event);
    case 'view':
      return view(screen, event);
    case 'poster':
      return poster(screen, event);
    case 'exporting':
      return exporting(screen, event);
  }
}

// ---------------------------------------------------------------------------------------------
// Page reducer and hook
// ---------------------------------------------------------------------------------------------

export interface PageState {
  readonly screen: Screen;
  readonly prefs: Prefs;
}

export type PageAction = ScreenEvent | PrefsEvent;

export const INITIAL_PAGE_STATE: PageState = { screen: INITIAL_SCREEN, prefs: INITIAL_PREFS };

function isPrefsEvent(action: PageAction): action is PrefsEvent {
  return action.type.startsWith('SET_');
}

export function pageReducer(state: PageState, action: PageAction): PageState {
  if (isPrefsEvent(action)) {
    const prefs = prefsReducer(state.prefs, action);
    return prefs === state.prefs ? state : { ...state, prefs };
  }

  const screen = screenReducer(state.screen, action);
  if (screen === state.screen) return state;

  let { prefs } = state;
  if (action.type === 'NEW_FILE') {
    prefs = withPoster(prefs, { title: '', subtitle: '', camera: DEFAULT_VIEW_CAMERA });
  } else if (action.type === 'MAKE_POSTER' && action.camera) {
    prefs = withPoster(prefs, { camera: action.camera });
  } else if (action.type === 'RUN_LOADED' && action.posterText) {
    prefs = withPoster(prefs, action.posterText);
  }
  return { screen, prefs };
}

/**
 * The poster's default title and subtitle for a run: its name, and no subtitle. The subtitle is
 * free text (a place, an event); the poster always shows the run's date on its own (DECISIONS
 * "Posters"), so seeding the subtitle with the date would print it twice.
 */
export function posterTextFor(run: Run): PosterText {
  return { title: run.name, subtitle: '' };
}

/**
 * The page's state and its one dispatch. `initial` is for stories and tests that start in a later
 * screen; the app starts on Upload with default preferences.
 */
export function usePageState(initial: PageState = INITIAL_PAGE_STATE): {
  state: PageState;
  dispatch: Dispatch<PageAction>;
} {
  const [state, dispatch] = useReducer(pageReducer, initial);
  return { state, dispatch };
}
