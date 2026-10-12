import { act, renderHook } from '@testing-library/react';
import { DEFAULT_VIEW_CAMERA } from '../terrain/camera';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RUN } from './sample';
import {
  INITIAL_PAGE_STATE,
  INITIAL_PREFS,
  INITIAL_SCREEN,
  isPosterMode,
  pageReducer,
  posterTextFor,
  usePageState,
} from './state';
import type {
  ExportingScreen,
  PageAction,
  PageState,
  PosterScreen,
  Screen,
  ScreenEvent,
  UploadScreen,
  ViewScreen,
} from './state';

const RUN_ID = 'run-1';

const reading: UploadScreen = {
  name: 'upload',
  busy: { kind: 'reading', fileName: 'loop.gpx' },
  error: null,
};
const loadingSample: UploadScreen = { name: 'upload', busy: { kind: 'sample' }, error: null };
const failed: UploadScreen = { name: 'upload', busy: { kind: 'idle' }, error: 'Not a GPX file.' };
const view: ViewScreen = { name: 'view', runId: RUN_ID };
const poster: PosterScreen = { name: 'poster', runId: RUN_ID, notice: null };
const exporting: ExportingScreen = {
  name: 'exporting',
  runId: RUN_ID,
  fileName: 'loop-18x24.png',
  progress: { done: 0, total: 12 },
};

const ALL_EVENTS: readonly ScreenEvent[] = [
  { type: 'FILE_CHOSEN', fileName: 'other.gpx' },
  { type: 'SAMPLE_CHOSEN' },
  { type: 'RUN_LOADED', runId: 'run-2' },
  { type: 'LOAD_FAILED', message: 'Nope.' },
  { type: 'NEW_FILE' },
  { type: 'MAKE_POSTER' },
  { type: 'BACK_TO_RUN' },
  { type: 'EXPORT_STARTED', fileName: 'x.png' },
  { type: 'EXPORT_PROGRESS', done: 1, total: 4 },
  { type: 'EXPORT_CANCELLED' },
  { type: 'EXPORT_DONE', fileName: 'x.png' },
  { type: 'EXPORT_FAILED', message: 'Nope.' },
];

function at(screen: Screen, prefs = INITIAL_PREFS): PageState {
  return { screen, prefs };
}

function send(state: PageState, ...actions: PageAction[]): PageState {
  return actions.reduce(pageReducer, state);
}

describe('initial state', () => {
  it('starts on an idle Upload screen with default preferences', () => {
    expect(INITIAL_PAGE_STATE.screen).toEqual({
      name: 'upload',
      busy: { kind: 'idle' },
      error: null,
    });
    expect(INITIAL_PAGE_STATE.prefs).toEqual({
      units: 'metric',
      exaggeration: 1.6,
      poster: {
        style: 'A',
        size: '18x24',
        title: '',
        subtitle: '',
        signature: '',
        stats: { distance: true, vert: true, time: true, highPoint: false },
        hideEnds: 200,
        camera: DEFAULT_VIEW_CAMERA,
      },
    });
  });
});

describe('upload', () => {
  it('FILE_CHOSEN reads the file and clears an earlier error', () => {
    expect(send(at(INITIAL_SCREEN), { type: 'FILE_CHOSEN', fileName: 'loop.gpx' }).screen).toEqual(
      reading,
    );
    expect(send(at(failed), { type: 'FILE_CHOSEN', fileName: 'loop.gpx' }).screen).toEqual(reading);
  });

  it('SAMPLE_CHOSEN loads the sample and clears an earlier error', () => {
    expect(send(at(INITIAL_SCREEN), { type: 'SAMPLE_CHOSEN' }).screen).toEqual(loadingSample);
    expect(send(at(failed), { type: 'SAMPLE_CHOSEN' }).screen).toEqual(loadingSample);
  });

  it('RUN_LOADED after a file or the sample goes to View', () => {
    for (const busy of [reading, loadingSample]) {
      expect(send(at(busy), { type: 'RUN_LOADED', runId: RUN_ID }).screen).toEqual(view);
    }
  });

  it('LOAD_FAILED returns to idle with the message', () => {
    for (const from of [reading, loadingSample, INITIAL_SCREEN]) {
      expect(send(at(from), { type: 'LOAD_FAILED', message: 'Not a GPX file.' }).screen).toEqual(
        failed,
      );
    }
  });

  it('ignores a second choice while busy, and RUN_LOADED when nothing is loading', () => {
    for (const busy of [reading, loadingSample]) {
      const state = at(busy);
      expect(send(state, { type: 'FILE_CHOSEN', fileName: 'other.gpx' })).toBe(state);
      expect(send(state, { type: 'SAMPLE_CHOSEN' })).toBe(state);
    }
    for (const idle of [INITIAL_SCREEN, failed]) {
      const state = at(idle);
      expect(send(state, { type: 'RUN_LOADED', runId: RUN_ID })).toBe(state);
    }
  });
});

describe('view', () => {
  it('MAKE_POSTER opens poster mode with no notice', () => {
    expect(send(at(view), { type: 'MAKE_POSTER' }).screen).toEqual(poster);
  });

  it('NEW_FILE returns to an idle Upload screen', () => {
    expect(send(at(view), { type: 'NEW_FILE' }).screen).toEqual(INITIAL_SCREEN);
  });
});

describe('poster', () => {
  it('BACK_TO_RUN returns to View', () => {
    expect(send(at(poster), { type: 'BACK_TO_RUN' }).screen).toEqual(view);
  });

  it('NEW_FILE returns to an idle Upload screen', () => {
    expect(send(at(poster), { type: 'NEW_FILE' }).screen).toEqual(INITIAL_SCREEN);
  });

  it('EXPORT_STARTED opens the export overlay with the total not known yet', () => {
    expect(send(at(poster), { type: 'EXPORT_STARTED', fileName: 'loop-18x24.png' }).screen).toEqual(
      { ...exporting, progress: { done: 0, total: null } },
    );
  });
});

describe('exporting overlay', () => {
  it('runs start → progress → done, then shows the saved notice in poster mode', () => {
    let state = send(at(poster), { type: 'EXPORT_STARTED', fileName: 'loop.png' });
    expect(state.screen).toMatchObject({ name: 'exporting', progress: { done: 0, total: null } });

    // The exporter's first report sets the total.
    state = send(state, { type: 'EXPORT_PROGRESS', done: 0, total: 3 });
    expect(state.screen).toMatchObject({ name: 'exporting', progress: { done: 0, total: 3 } });

    state = send(
      state,
      { type: 'EXPORT_PROGRESS', done: 1, total: 3 },
      { type: 'EXPORT_PROGRESS', done: 2, total: 3 },
    );
    expect(state.screen).toMatchObject({ name: 'exporting', progress: { done: 2, total: 3 } });

    state = send(state, { type: 'EXPORT_DONE', fileName: 'loop.png' });
    expect(state.screen).toEqual({
      name: 'poster',
      runId: RUN_ID,
      notice: { kind: 'saved', fileName: 'loop.png' },
    });
  });

  it('lets the exporter change the total between reports', () => {
    const state = send(at(exporting), { type: 'EXPORT_PROGRESS', done: 5, total: 20 });
    expect(state.screen).toMatchObject({ progress: { done: 5, total: 20 } });
    expect(send(state, { type: 'EXPORT_PROGRESS', done: 5, total: 4 }).screen).toMatchObject({
      progress: { done: 4, total: 4 },
    });
  });

  it('carries the encode stage, with every tile done, and leaves it if tiles are reported again', () => {
    const state = send(at(exporting), { type: 'EXPORT_PROGRESS', done: 7, total: 8 });
    const encoding = send(state, { type: 'EXPORT_PROGRESS', done: 3, total: 8, stage: 'encode' });
    expect(encoding.screen).toMatchObject({ progress: { done: 8, total: 8, stage: 'encode' } });
    expect(send(encoding, { type: 'EXPORT_PROGRESS', done: 8, total: 8, stage: 'encode' })).toBe(
      encoding,
    );
    const back = send(encoding, { type: 'EXPORT_PROGRESS', done: 8, total: 8 });
    expect(back.screen).toMatchObject({ progress: { done: 8, total: 8 } });
    expect((back.screen as { progress: object }).progress).not.toHaveProperty('stage');
  });

  it('EXPORT_FAILED returns to poster mode with the error notice', () => {
    const state = send(at(exporting), { type: 'EXPORT_FAILED', message: 'Too large.' });
    expect(state.screen).toEqual({
      name: 'poster',
      runId: RUN_ID,
      notice: { kind: 'failed', message: 'Too large.' },
    });
    // The next export clears it.
    expect(
      send(state, { type: 'EXPORT_STARTED', fileName: 'x.png' }, { type: 'EXPORT_CANCELLED' })
        .screen,
    ).toEqual(poster);
  });

  it('cancel returns to poster mode without a notice', () => {
    const state = send(at(exporting), { type: 'EXPORT_PROGRESS', done: 4, total: 12 });
    expect(send(state, { type: 'EXPORT_CANCELLED' }).screen).toEqual(poster);
  });

  it('a new export clears the previous saved notice, and BACK_TO_RUN drops it', () => {
    const saved: PosterScreen = { ...poster, notice: { kind: 'saved', fileName: 'old.png' } };
    const next = send(at(saved), { type: 'EXPORT_STARTED', fileName: 'new.png' });
    expect(send(next, { type: 'EXPORT_CANCELLED' }).screen).toEqual(poster);
    expect(send(at(saved), { type: 'BACK_TO_RUN' }).screen).toEqual(view);
  });

  it('clamps progress to 0…total and ignores NaN, bad totals and no-op updates', () => {
    const state = at(exporting);
    const progress = (done: number, total = 12) =>
      send(state, { type: 'EXPORT_PROGRESS', done, total });
    expect(progress(99).screen).toMatchObject({ progress: { done: 12, total: 12 } });
    expect(progress(-3)).toBe(state);
    expect(progress(Number.NaN)).toBe(state);
    expect(progress(4.7).screen).toMatchObject({ progress: { done: 4 } });
    for (const total of [0, -1, 2.5, Number.NaN]) expect(progress(1, total)).toBe(state);
  });

  it('counts as poster mode, as does poster', () => {
    expect(isPosterMode(exporting)).toBe(true);
    expect(isPosterMode(poster)).toBe(true);
    expect(isPosterMode(view)).toBe(false);
    expect(isPosterMode(INITIAL_SCREEN)).toBe(false);
  });
});

describe('invalid transitions are ignored', () => {
  const valid: Record<Screen['name'], readonly ScreenEvent['type'][]> = {
    upload: ['FILE_CHOSEN', 'SAMPLE_CHOSEN', 'RUN_LOADED', 'LOAD_FAILED'],
    view: ['NEW_FILE', 'MAKE_POSTER'],
    poster: ['NEW_FILE', 'BACK_TO_RUN', 'EXPORT_STARTED'],
    exporting: ['EXPORT_PROGRESS', 'EXPORT_CANCELLED', 'EXPORT_DONE', 'EXPORT_FAILED'],
  };
  const screens: readonly Screen[] = [INITIAL_SCREEN, reading, view, poster, exporting];

  for (const screen of screens) {
    const ignored = ALL_EVENTS.filter((event) => !valid[screen.name].includes(event.type));
    it(`${screen.name}${screen.name === 'upload' ? ` (${screen.busy.kind})` : ''} ignores ${ignored.map((e) => e.type).join(', ')}`, () => {
      const state = at(screen);
      for (const event of ignored) expect(send(state, event)).toBe(state);
    });
  }

  it('types each screen to the events it accepts', () => {
    const viewEvent: ScreenEvent<'view'> = { type: 'MAKE_POSTER' };
    // @ts-expect-error: Upload cannot send MAKE_POSTER.
    const uploadEvent: ScreenEvent<'upload'> = { type: 'MAKE_POSTER' };
    // @ts-expect-error: the export overlay cannot go back to the run.
    const exportingEvent: ScreenEvent<'exporting'> = { type: 'BACK_TO_RUN' };
    expect([viewEvent, uploadEvent, exportingEvent]).toHaveLength(3);
  });
});

describe('preferences', () => {
  it('sets units, exaggeration and every poster setting', () => {
    const { prefs } = send(
      INITIAL_PAGE_STATE,
      { type: 'SET_UNITS', units: 'imperial' },
      { type: 'SET_EXAGGERATION', value: 2.3 },
      { type: 'SET_POSTER_STYLE', style: 'E' },
      { type: 'SET_POSTER_SIZE', size: '4x5' },
      { type: 'SET_POSTER_TEXT', field: 'title', value: 'Coosa' },
      { type: 'SET_POSTER_TEXT', field: 'subtitle', value: 'Vogel State Park' },
      { type: 'SET_POSTER_TEXT', field: 'signature', value: '@sean' },
      { type: 'SET_POSTER_STAT', stat: 'highPoint', shown: true },
      { type: 'SET_POSTER_STAT', stat: 'time', shown: false },
      { type: 'SET_HIDE_ENDS', metres: 400 },
    );
    expect(prefs).toEqual({
      units: 'imperial',
      exaggeration: 2.3,
      poster: {
        style: 'E',
        size: '4x5',
        title: 'Coosa',
        subtitle: 'Vogel State Park',
        signature: '@sean',
        stats: { distance: true, vert: true, time: false, highPoint: true },
        hideEnds: 400,
        camera: DEFAULT_VIEW_CAMERA,
      },
    });
  });

  it('clamps and snaps exaggeration to 1–3 by 0.1', () => {
    const exaggeration = (value: number) =>
      send(INITIAL_PAGE_STATE, { type: 'SET_EXAGGERATION', value }).prefs.exaggeration;
    expect(exaggeration(0.2)).toBe(1);
    expect(exaggeration(9)).toBe(3);
    expect(exaggeration(1.7000000000000002)).toBe(1.7);
    expect(exaggeration(2.04)).toBe(2);
    expect(exaggeration(Number.NaN)).toBe(1.6);
  });

  it('clamps and snaps hide-ends to 0–500 by 100', () => {
    const hideEnds = (metres: number) =>
      send(INITIAL_PAGE_STATE, { type: 'SET_HIDE_ENDS', metres }).prefs.poster.hideEnds;
    expect(hideEnds(-50)).toBe(0);
    expect(hideEnds(730)).toBe(500);
    expect(hideEnds(260)).toBe(300);
    expect(hideEnds(Number.NaN)).toBe(200);
  });

  it('can be changed in any screen without changing the screen', () => {
    for (const screen of [INITIAL_SCREEN, view, poster, exporting]) {
      const state = send(at(screen), { type: 'SET_UNITS', units: 'imperial' });
      expect(state.screen).toBe(screen);
      expect(state.prefs.units).toBe('imperial');
    }
  });

  it('RUN_LOADED seeds the poster title and subtitle when given', () => {
    const posterText = posterTextFor(SAMPLE_RUN);
    expect(posterText).toEqual({ title: 'Coosa Backcountry Trail', subtitle: '' });
    const state = send(at(loadingSample), { type: 'RUN_LOADED', runId: RUN_ID, posterText });
    expect(state.prefs.poster).toMatchObject(posterText);
  });

  it('the poster subtitle starts empty with or without a date (the poster shows the date itself)', () => {
    expect(posterTextFor({ ...SAMPLE_RUN, startTime: NaN })).toEqual({
      title: 'Coosa Backcountry Trail',
      subtitle: '',
    });
  });

  it('an ignored RUN_LOADED does not seed the poster text', () => {
    const posterText = posterTextFor(SAMPLE_RUN);
    const state = at(view);
    expect(send(state, { type: 'RUN_LOADED', runId: RUN_ID, posterText })).toBe(state);
  });

  it('MAKE_POSTER hands the View’s camera to the poster', () => {
    const camera = { azimuth: -1.2, polar: 0.9, zoom: 0.8, view: 'oblique' } as const;
    const state = send(at(view), { type: 'MAKE_POSTER', camera });
    expect(state.screen.name).toBe('poster');
    expect(state.prefs.poster.camera).toEqual(camera);
    // Without one (no terrain drawn yet) the poster keeps the camera it had.
    const again = send(state, { type: 'BACK_TO_RUN' }, { type: 'MAKE_POSTER' });
    expect(again.prefs.poster.camera).toEqual(camera);
    // Ignored in other screens: no camera change either.
    const ignored = at(poster);
    expect(send(ignored, { type: 'MAKE_POSTER', camera })).toBe(ignored);
  });

  it('NEW_FILE keeps units, exaggeration, poster settings and signature; resets title, subtitle and camera', () => {
    const configured = send(
      at(view),
      { type: 'MAKE_POSTER', camera: { azimuth: 2, polar: 1, zoom: 1.5, view: 'flat' } },
      { type: 'BACK_TO_RUN' },
      { type: 'SET_UNITS', units: 'imperial' },
      { type: 'SET_EXAGGERATION', value: 2.5 },
      { type: 'SET_POSTER_STYLE', style: 'B' },
      { type: 'SET_POSTER_SIZE', size: 'a3' },
      { type: 'SET_POSTER_TEXT', field: 'title', value: 'Old run' },
      { type: 'SET_POSTER_TEXT', field: 'subtitle', value: 'Old place' },
      { type: 'SET_POSTER_TEXT', field: 'signature', value: '@sean' },
      { type: 'SET_POSTER_STAT', stat: 'highPoint', shown: true },
      { type: 'SET_HIDE_ENDS', metres: 0 },
    );
    const { screen, prefs } = send(configured, { type: 'NEW_FILE' });
    expect(screen).toEqual(INITIAL_SCREEN);
    expect(prefs).toEqual({
      ...configured.prefs,
      poster: {
        ...configured.prefs.poster,
        title: '',
        subtitle: '',
        camera: DEFAULT_VIEW_CAMERA,
      },
    });
  });

  it('an ignored NEW_FILE (during export) keeps the poster text', () => {
    const state = send(at(exporting), { type: 'SET_POSTER_TEXT', field: 'title', value: 'Keep' });
    expect(send(state, { type: 'NEW_FILE' })).toBe(state);
  });
});

describe('usePageState', () => {
  it('walks upload → view → poster → exporting → poster through one dispatch', () => {
    const { result } = renderHook(() => usePageState());
    const dispatch = (action: PageAction) => {
      act(() => {
        result.current.dispatch(action);
      });
    };

    dispatch({ type: 'SAMPLE_CHOSEN' });
    expect(result.current.state.screen).toEqual(loadingSample);
    dispatch({ type: 'RUN_LOADED', runId: RUN_ID });
    dispatch({ type: 'SET_UNITS', units: 'imperial' });
    dispatch({ type: 'MAKE_POSTER' });
    dispatch({ type: 'EXPORT_STARTED', fileName: 'a.png' });
    dispatch({ type: 'EXPORT_PROGRESS', done: 2, total: 2 });
    dispatch({ type: 'EXPORT_DONE', fileName: 'a.png' });
    expect(result.current.state).toEqual({
      screen: { name: 'poster', runId: RUN_ID, notice: { kind: 'saved', fileName: 'a.png' } },
      prefs: { ...INITIAL_PREFS, units: 'imperial' },
    });
  });

  it('can start from a given state', () => {
    const initial = at(view);
    const { result } = renderHook(() => usePageState(initial));
    expect(result.current.state).toBe(initial);
  });
});
