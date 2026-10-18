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
import { DEFAULT_VIEW_CAMERA } from '../terrain/camera';
import styles from './Page.module.css';

export interface PageProps extends Omit<RunProviderProps, 'children'> {
  /** Start in a given state (stories and tests); the app starts on Upload with default prefs. */
  initialState?: PageState;
  /** Open the About dialog on first render (stories only). */
  initialAboutOpen?: boolean;
  /** Renders and saves posters (tests, stories). Default: Poster mode's `defaultExporter`. */
  exporter?: Exporter;
}

/**
 * The one page (DESIGN-SPEC §3): the header with the current state's controls, then the current
 * state. Owns the state machine (`usePageState`) inside `RunProvider`.
 */
export function Page({ initialState, initialAboutOpen = false, exporter, ...runProps }: PageProps) {
  return (
    <RunProvider {...runProps}>
      <PageContent
        initialState={initialState}
        initialAboutOpen={initialAboutOpen}
        exporter={exporter}
      />
    </RunProvider>
  );
}

function PageContent({
  initialState,
  initialAboutOpen,
  exporter,
}: {
  initialState?: PageState;
  initialAboutOpen: boolean;
  exporter?: Exporter;
}) {
  const { state, dispatch } = usePageState(initialState);
  // `newFile` is ignored while a load is in flight and forgets the run (hooks.ts).
  const { chooseFile, chooseSample, newFile } = useRunChooser(dispatch);
  const run = useRun();
  const terrain = useTerrain();
  const retryTerrain = useRetryTerrain();
  const loadFigureTerrain = useFigureTerrainLoader();
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const { screen, prefs } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cameraRef = useRef<TerrainCameraSource>(null);
  // Exporting is an overlay on poster mode, not a new screen: PosterState moves focus for it.
  const screenKey = isPosterMode(screen) ? 'poster' : screen.name;
  useFocusOnScreenChange(screenKey, headingRef);

  // A file dropped anywhere, on any screen (README "Dropping a file"). On Upload it goes straight
  // to the Dropzone. On View and Poster mode the page checks it first: a wrong file keeps the run
  // on screen and says why under the header; a GPX leaves the run (New file) and Upload's Dropzone
  // takes it once mounted, so every file is loaded (and a broken one reported) the same way.
  const dropzoneRef = useRef<DropzoneHandle>(null);
  const pendingFiles = useRef<File[] | null>(null);
  // Why the last drop on a run was not opened, for the screen it was dropped on (`screenKey`):
  // the alert goes when the screen changes. A new `id` per message remounts (re-announces) it.
  const [dropError, setDropError] = useState<{
    message: string;
    id: number;
    screenKey: string;
  } | null>(null);
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
      pendingFiles.current = [picked.file];
      if (!newFile()) pendingFiles.current = null;
    },
  });
  useEffect(() => {
    const files = pendingFiles.current;
    // Whatever the new screen, files waiting from before are used once or dropped.
    pendingFiles.current = null;
    if (screen.name === 'upload' && files) dropzoneRef.current?.takeFiles(files);
  }, [screen.name]);

  return (
    <div
      className={[styles.page, isPosterMode(screen) && styles.posterMode].filter(Boolean).join(' ')}
    >
      {screen.name === 'upload' ? (
        <AppHeader state="upload">
          <UploadNav
            aboutRef={aboutRef}
            onAbout={() => {
              setAboutOpen(true);
            }}
          />
        </AppHeader>
      ) : screen.name === 'view' ? (
        <AppHeader state="view">
          <ViewNav
            units={prefs.units}
            onUnitsChange={(units) => {
              dispatch({ type: 'SET_UNITS', units });
            }}
            onNewFile={newFile}
            onMakePoster={() => {
              // "Make a poster" uses the current camera (BRIEF): the View's, as the user left it.
              const camera = cameraRef.current?.camera() ?? undefined;
              dispatch(camera ? { type: 'MAKE_POSTER', camera } : { type: 'MAKE_POSTER' });
            }}
          />
        </AppHeader>
      ) : (
        <AppHeader state="poster" routeName={run?.name ?? ''}>
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
          <DropOverlay routeName={run?.name ?? ''} />
        )
      ) : null}
      {/*
       * Says what the drop overlay draws. Always rendered, so the region exists before its text
       * changes (a status inserted with the overlay is often not announced).
       */}
      <p role="status" className={styles.visuallyHidden}>
        {dragOver && screen.name !== 'upload' ? dropOverlayAnnouncement(run?.name ?? '') : ''}
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
 * DECISIONS "Focus on screen changes": when the screen changes (upload → view → poster and back),
 * focus moves to the new screen's h1 (`tabIndex={-1}`) and the page returns to the top, so keyboard
 * and screen-reader users start at the top of the new content. Not on first render: the app opens
 * at the top of the document already.
 */
function useFocusOnScreenChange(screenKey: string, headingRef: RefObject<HTMLElement | null>) {
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
