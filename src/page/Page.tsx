import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { pickGpxFile } from '../components';
import type { DropzoneHandle } from '../components';
import { AboutDialog } from './AboutDialog/AboutDialog';
import { AppHeader } from './AppHeader/AppHeader';
import { PosterNav } from './AppHeader/PosterNav';
import { UploadNav } from './AppHeader/UploadNav';
import { ViewNav } from './AppHeader/ViewNav';
import { DropAlert } from './DropFrame/DropAlert';
import { DropFrame } from './DropFrame/DropFrame';
import { DropOverlay, dropOverlayAnnouncement } from './DropFrame/DropOverlay';
import {
  RunProvider,
  useFigureTerrainLoader,
  useRetryTerrain,
  useRun,
  useRunChooser,
  useScene,
  useTerrain,
} from './hooks';
import type { RunProviderProps } from './hooks';
import type { Exporter } from './PosterState/exporter';
import { PosterState } from './PosterState/PosterState';
import { isPosterMode, usePageState } from './state';
import type { PageState } from './state';
import { UploadState } from './UploadState/UploadState';
import { useWindowFileDrop } from './useWindowFileDrop';
import type { TerrainCameraSource } from './ViewState/TerrainBox';
import { ViewState } from './ViewState/ViewState';
import { SceneViewState } from './ViewState/SceneViewState';
import { forgetSceneParam, parseSceneParam, sceneTitle } from './sceneLink';
import { DEFAULT_VIEW_CAMERA } from '../terrain/camera';
import styles from './Page.module.css';

/** The screen as the page shows it: exporting is Poster mode with an overlay, not a new screen. */
type ScreenKey = 'upload' | 'view' | 'poster';

export interface PageProps extends Omit<RunProviderProps, 'children'> {
  /** Start in a given state (stories and tests); the app starts on Upload with default prefs. */
  initialState?: PageState;
  /** Open the About dialog on first render (stories only). */
  initialAboutOpen?: boolean;
  /** Renders and saves posters (tests, stories). Default: Poster mode's `defaultExporter`. */
  exporter?: Exporter;
  /**
   * The `?scene=` parameter the page was opened with (`App` reads it from the address bar), or
   * null: the page then opens that scene at once (src/page/sceneLink.ts). Read on mount only.
   */
  sceneParam?: string | null;
  /** The `&title=` parameter that goes with it (`sceneTitle` sanitises it), or null. */
  titleParam?: string | null;
}

/**
 * The one page (DESIGN-SPEC §3): the header with the current state's controls, then the current
 * state. Owns the state machine (`usePageState`) inside `RunProvider`.
 */
export function Page({
  initialState,
  initialAboutOpen = false,
  exporter,
  sceneParam = null,
  titleParam = null,
  ...runProps
}: PageProps) {
  return (
    <RunProvider {...runProps}>
      <PageContent
        initialState={initialState}
        initialAboutOpen={initialAboutOpen}
        exporter={exporter}
        sceneParam={sceneParam}
        titleParam={titleParam}
      />
    </RunProvider>
  );
}

function PageContent({
  initialState,
  initialAboutOpen,
  exporter,
  sceneParam,
  titleParam,
}: {
  initialState?: PageState;
  initialAboutOpen: boolean;
  exporter?: Exporter;
  sceneParam: string | null;
  titleParam: string | null;
}) {
  const { state, dispatch } = usePageState(initialState);
  // `newFile` is ignored while a load is in flight and forgets the run (hooks.ts).
  const chooser = useRunChooser(dispatch);
  const { chooseScene } = chooser;
  // Opening anything else, or leaving the scene, takes `?scene=` out of the address bar, so a
  // reload shows what is on screen (DECISIONS "Page: open a scene by URL").
  const chooseFile = (file: File) => {
    forgetSceneParam();
    chooser.chooseFile(file);
  };
  const chooseSample = () => {
    forgetSceneParam();
    chooser.chooseSample();
  };
  const newFile = () => {
    const acted = chooser.newFile();
    if (acted) forgetSceneParam();
    return acted;
  };
  const run = useRun();
  const linkedScene = useScene();
  const terrain = useTerrain();
  const retryTerrain = useRetryTerrain();
  const loadFigureTerrain = useFigureTerrainLoader();
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const { screen, prefs } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cameraRef = useRef<TerrainCameraSource>(null);
  // Exporting is an overlay on poster mode, not a new screen: PosterState moves focus for it.
  const screenKey: ScreenKey = isPosterMode(screen) ? 'poster' : screen.name;
  useFocusOnScreenChange(screenKey, headingRef);

  // A file dropped anywhere, on any screen (README "Dropping a file"). On Upload it goes straight
  // to the Dropzone. On View and Poster mode the page checks it first: a wrong file keeps the run
  // on screen and says why under the header; a GPX leaves the run (New file) and Upload's Dropzone
  // takes it once mounted, so every file is loaded (and a broken one reported) the same way.
  const dropzoneRef = useRef<DropzoneHandle>(null);
  // A GPX dropped on a run, waiting for Upload's Dropzone, and the screen it was dropped on.
  const pendingFiles = useRef<{ files: File[]; from: ScreenKey } | null>(null);
  // Why the last drop on a run was not opened, for the screen it was dropped on (`screenKey`):
  // the alert goes when the screen changes. A new `id` per message remounts (re-announces) it.
  const [dropError, setDropError] = useState<{
    message: string;
    id: number;
    screenKey: ScreenKey;
  } | null>(null);
  // `?scene=<url>`: open it on mount, as if the file had been chosen on Upload. A link that cannot
  // be fetched says why there, above the Dropzone. The parameter is kept until the open has an
  // answer: under StrictMode the provider's simulated unmount aborts the first fetch (its
  // `chooseScene` resolves `false`) and the effect's second run opens it again.
  const sceneParamRef = useRef(sceneParam);
  const titleParamRef = useRef(titleParam);
  useEffect(() => {
    const parsed = parseSceneParam(sceneParamRef.current);
    if (!parsed) return;
    if ('error' in parsed) {
      sceneParamRef.current = null;
      dispatch({ type: 'LOAD_FAILED', message: parsed.error });
      return;
    }
    void chooseScene(parsed.url, sceneTitle(titleParamRef.current)).then((answered) => {
      if (answered) sceneParamRef.current = null;
    });
  }, [chooseScene, dispatch]);

  const shownName = run?.name ?? linkedScene?.name ?? '';

  const { dragOver } = useWindowFileDrop({
    disabled:
      screen.name === 'exporting' || (screen.name === 'upload' && screen.busy.kind !== 'idle'),
    onFiles: (files) => {
      if (screen.name === 'upload') {
        dropzoneRef.current?.takeFiles(files);
        return;
      }
      const picked = pickGpxFile(files);
      if (!picked) return;
      if ('error' in picked) {
        setDropError((previous) => ({
          message: picked.error,
          id: (previous?.id ?? 0) + 1,
          screenKey,
        }));
        return;
      }
      setDropError(null);
      // Kept only if New file really leaves the screen (it is a no-op while a load is in
      // flight), so files never wait for some later, unrelated screen change.
      pendingFiles.current = { files: [picked.file], from: screenKey };
      if (!newFile()) pendingFiles.current = null;
    },
  });
  useEffect(() => {
    const pending = pendingFiles.current;
    // A run that loads is an update no user event started, so React runs the View commit's
    // effects after paint, or first thing in the next update: here New file's. A drop right then
    // reaches this effect for the screen the files were dropped on. That is not a later screen:
    // leave them for Upload. (An export that finishes is such an update too, but exporting and
    // poster share a key, so no effect runs then: keying on `screenKey`, not `screen.name`.)
    if (!pending || pending.from === screenKey) return;
    // Any other screen: used once (Upload) or dropped.
    pendingFiles.current = null;
    if (screenKey === 'upload') dropzoneRef.current?.takeFiles(pending.files);
  }, [screenKey]);

  // The wordmark (a link to "/"), on a plain click. It goes where New file goes: Upload, through
  // `newFile` (a no-op while a load is in flight). On Upload it returns to the top and its h1.
  // During an export it does nothing, like Back to the run (disabled then): AppHeader is told
  // `homeDisabled`, keeps the link focusable and ignores the click.
  const goHome = () => {
    if (screen.name === 'upload') {
      returnToTop(headingRef);
      return;
    }
    if (screen.name === 'exporting') return;
    newFile();
  };

  return (
    <div
      className={[styles.page, isPosterMode(screen) && styles.posterMode].filter(Boolean).join(' ')}
    >
      {screen.name === 'upload' ? (
        <AppHeader state="upload" onHome={goHome}>
          <UploadNav
            aboutRef={aboutRef}
            onAbout={() => {
              setAboutOpen(true);
            }}
          />
        </AppHeader>
      ) : screen.name === 'view' ? (
        <AppHeader state="view" onHome={goHome}>
          <ViewNav
            units={prefs.units}
            onUnitsChange={(units) => {
              dispatch({ type: 'SET_UNITS', units });
            }}
            onNewFile={newFile}
            // A scene from a link has no poster (no coordinates): no Make a poster.
            onMakePoster={
              run
                ? () => {
                    // "Make a poster" uses the current camera: the View's, as the user left it.
                    const camera = cameraRef.current?.camera() ?? undefined;
                    dispatch(camera ? { type: 'MAKE_POSTER', camera } : { type: 'MAKE_POSTER' });
                  }
                : undefined
            }
          />
        </AppHeader>
      ) : (
        <AppHeader
          state="poster"
          routeName={run?.name ?? ''}
          onHome={goHome}
          homeDisabled={screen.name === 'exporting'}
        >
          <PosterNav
            // The state machine ignores BACK_TO_RUN while exporting; the button says so.
            disabled={screen.name === 'exporting'}
            onBack={() => {
              dispatch({ type: 'BACK_TO_RUN' });
            }}
          />
        </AppHeader>
      )}

      {dropError?.screenKey === screenKey ? (
        <DropAlert
          key={dropError.id}
          message={dropError.message}
          onDismiss={() => {
            setDropError(null);
          }}
        />
      ) : null}

      {screen.name === 'upload' ? (
        <UploadState
          headingRef={headingRef}
          screen={screen}
          units={prefs.units}
          onFile={chooseFile}
          onSample={chooseSample}
          dragOver={dragOver}
          dropzoneRef={dropzoneRef}
        />
      ) : screen.name === 'view' && run ? (
        // Keyed by run: a new run starts with its own scrub position.
        <ViewState
          key={run.id}
          run={run}
          headingRef={headingRef}
          units={prefs.units}
          exaggeration={prefs.exaggeration}
          terrain={terrain}
          onRetryTerrain={retryTerrain}
          onExaggerationChange={(value) => {
            dispatch({ type: 'SET_EXAGGERATION', value });
          }}
          cameraRef={cameraRef}
          // Back from Poster mode: start where the poster's camera is (Make a poster set it from
          // this View; New file resets it to the default, which plays the intro instead).
          initialCamera={
            prefs.poster.camera === DEFAULT_VIEW_CAMERA ? undefined : prefs.poster.camera
          }
        />
      ) : screen.name === 'view' && linkedScene ? (
        // Keyed by scene: a new one starts with its own scrub position.
        <SceneViewState
          key={linkedScene.id}
          linked={linkedScene}
          headingRef={headingRef}
          units={prefs.units}
          exaggeration={prefs.exaggeration}
          onExaggerationChange={(value) => {
            dispatch({ type: 'SET_EXAGGERATION', value });
          }}
          cameraRef={cameraRef}
        />
      ) : isPosterMode(screen) && run ? (
        // Exporting is poster mode with the export progress under the Download button.
        <PosterState
          run={run}
          screen={screen}
          prefs={prefs}
          dispatch={dispatch}
          headingRef={headingRef}
          exporter={exporter}
          terrain={terrain}
          loadFigureTerrain={loadFigureTerrain}
          onRetryTerrain={retryTerrain}
        />
      ) : null}

      {dragOver ? (
        screen.name === 'upload' ? (
          <DropFrame />
        ) : (
          <DropOverlay routeName={shownName} />
        )
      ) : null}
      {/*
       * Says what the drop overlay draws. Always rendered, so the region exists before its text
       * changes (a status inserted with the overlay is often not announced).
       */}
      <p role="status" className={styles.visuallyHidden}>
        {dragOver && screen.name !== 'upload' ? dropOverlayAnnouncement(shownName) : ''}
      </p>

      <AboutDialog
        open={aboutOpen}
        onClose={() => {
          setAboutOpen(false);
        }}
        returnFocusRef={aboutRef}
      />
    </div>
  );
}

/**
 * The wordmark on Upload: no state change; back to the top of the page (instantly with reduced
 * motion) and focus on the h1, as when Upload opens.
 */
function returnToTop(headingRef: RefObject<HTMLElement | null>) {
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
  headingRef.current?.focus({ preventScroll: true });
}

/**
 * DECISIONS "Focus on screen changes": when the screen changes (upload → view → poster and back),
 * focus moves to the new screen's h1 (`tabIndex={-1}`) and the page returns to the top, so keyboard
 * and screen-reader users start at the top of the new content. Not on first render: the app opens
 * at the top of the document already.
 */
function useFocusOnScreenChange(screenKey: ScreenKey, headingRef: RefObject<HTMLElement | null>) {
  const previous = useRef(screenKey);
  useEffect(() => {
    if (previous.current === screenKey) return;
    previous.current = screenKey;
    // Below 900px the View's h1 sits under the terrain; start at the top, not scrolled to it.
    const root = document.scrollingElement;
    if (root) root.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [screenKey, headingRef]);
}
