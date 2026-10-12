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
 * - `NEW_FILE` resets the poster's title and subtitle, which describe the old run. Everything
 *   else persists until reload: units, exaggeration, poster style, size, which stats show, hide
 *   ends, and the signature (it describes the author, not the run).
 *
 * Screens and transitions:
 *
 *   upload ──FILE_CHOSEN / SAMPLE_CHOSEN──▶ upload (busy) ──RUN_LOADED──▶ view
 *   upload (busy) ──LOAD_FAILED──▶ upload (error)
 *   view ──MAKE_POSTER──▶ poster ──BACK_TO_RUN──▶ view
 *   view, poster ──NEW_FILE──▶ upload
 *   poster ──EXPORT_STARTED──▶ exporting ──EXPORT_PROGRESS──▶ exporting
 *   exporting ──EXPORT_DONE──▶ poster (with "Saved <file>") │ ──EXPORT_CANCELLED──▶ poster
 *
 * `exporting` is an overlay on poster mode: the page keeps showing the poster screen and adds the
 * progress bar (`isPosterMode`). Any other event in a screen is ignored (the state is returned
 * unchanged). `ScreenEvent<'view'>` etc. type the events a screen accepts, so a screen's component
 * can be handed a dispatch that cannot send an invalid one.
 */
import { useReducer } from 'react';
import type { Dispatch } from 'react';
import { formatDateLine } from '../lib/format';
import type { Units } from '../lib/format';
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

export interface PosterScreen {
  readonly name: 'poster';
  readonly runId: string;
  /** Set after an export completes ("Saved <savedFileName>"); cleared by the next export. */
  readonly notice: { readonly savedFileName: string } | null;
}

/** Poster mode with the export overlay on top. */
export interface ExportingScreen {
  readonly name: 'exporting';
  readonly runId: string;
  /** The file being written, e.g. "coosa-backcountry-loop-18x24.png". */
  readonly fileName: string;
  /** Tiles rendered so far out of the total ("Rendering tile 4 of 12"); 0 ≤ done ≤ total. */
  readonly progress: { readonly done: number; readonly total: number };
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
}
export interface BackToRun {
  readonly type: 'BACK_TO_RUN';
}
export interface ExportStarted {
  readonly type: 'EXPORT_STARTED';
  /** Tiles to render, an integer ≥ 1. */
  readonly total: number;
  readonly fileName: string;
}
export interface ExportProgress {
  readonly type: 'EXPORT_PROGRESS';
  readonly done: number;
}
export interface ExportCancelled {
  readonly type: 'EXPORT_CANCELLED';
}
export interface ExportDone {
  readonly type: 'EXPORT_DONE';
  readonly fileName: string;
}

/** The events each screen accepts. Everything else is ignored in that screen. */
export interface ScreenEvents {
  upload: FileChosen | SampleChosen | RunLoaded | LoadFailed;
  view: NewFile | MakePoster;
  poster: NewFile | BackToRun | ExportStarted;
  exporting: ExportProgress | ExportCancelled | ExportDone;
}

/** Events valid in screen `N` (`ScreenEvent<'view'>`), or in any screen (`ScreenEvent`). */
export type ScreenEvent<N extends ScreenName = ScreenName> = ScreenEvents[N];

// ---------------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------------

export type PosterStyle = 'A' | 'B' | 'E';

/** Poster sizes (DESIGN-SPEC §4) with their pixel targets. */
export const POSTER_SIZES = {
  '18x24': { width: 5400, height: 7200 },
  a3: { width: 3508, height: 4961 },
  '4x5': { width: 1080, height: 1350 },
  '9x16': { width: 1080, height: 1920 },
} as const;
export type PosterSizeId = keyof typeof POSTER_SIZES;

export type PosterStat = 'distance' | 'vert' | 'time' | 'highPoint';
export type PosterTextField = 'title' | 'subtitle' | 'signature';

export interface PosterPrefs {
  readonly style: PosterStyle;
  readonly size: PosterSizeId;
  readonly title: string;
  readonly subtitle: string;
  readonly signature: string;
  readonly stats: Readonly<Record<PosterStat, boolean>>;
  /** Metres of route hidden at the start and the end, 0–500 in steps of 100. */
  readonly hideEnds: number;
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
  },
};

export type PrefsEvent =
  | { readonly type: 'SET_UNITS'; readonly units: Units }
  | { readonly type: 'SET_EXAGGERATION'; readonly value: number }
  | { readonly type: 'SET_POSTER_STYLE'; readonly style: PosterStyle }
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
      if (!Number.isInteger(event.total) || event.total < 1) return screen;
      return {
        name: 'exporting',
        runId: screen.runId,
        fileName: event.fileName,
        progress: { done: 0, total: event.total },
      };
    default:
      return screen;
  }
}

function exporting(screen: ExportingScreen, event: ScreenEvent): Screen {
  switch (event.type) {
    case 'EXPORT_PROGRESS': {
      if (Number.isNaN(event.done)) return screen;
      const { total } = screen.progress;
      const done = Math.min(total, Math.max(0, Math.floor(event.done)));
      return done === screen.progress.done ? screen : { ...screen, progress: { done, total } };
    }
    case 'EXPORT_CANCELLED':
      return { name: 'poster', runId: screen.runId, notice: null };
    case 'EXPORT_DONE':
      return { name: 'poster', runId: screen.runId, notice: { savedFileName: event.fileName } };
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
    prefs = withPoster(prefs, { title: '', subtitle: '' });
  } else if (action.type === 'RUN_LOADED' && action.posterText) {
    prefs = withPoster(prefs, action.posterText);
  }
  return { screen, prefs };
}

/** The poster's default title and subtitle for a run: its name, and "SAT · 2026-10-03". */
export function posterTextFor(run: Run): PosterText {
  return { title: run.name, subtitle: formatDateLine(new Date(run.startTime), run.lonForOffset) };
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
