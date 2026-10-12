import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { AboutDialog } from './AboutDialog/AboutDialog';
import { AppHeader } from './AppHeader/AppHeader';
import { PosterNav } from './AppHeader/PosterNav';
import { UploadNav } from './AppHeader/UploadNav';
import { ViewNav } from './AppHeader/ViewNav';
import { RunProvider, useRetryTerrain, useRun, useRunChooser, useTerrain } from './hooks';
import type { RunProviderProps } from './hooks';
import type { Exporter } from './PosterState/exporter';
import { PosterState } from './PosterState/PosterState';
import { isPosterMode, usePageState } from './state';
import type { PageState } from './state';
import { UploadState } from './UploadState/UploadState';
import { ViewState } from './ViewState/ViewState';
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
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const { screen, prefs } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Exporting is an overlay on poster mode, not a new screen: PosterState moves focus for it.
  useFocusOnScreenChange(isPosterMode(screen) ? 'poster' : screen.name, headingRef);

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
              dispatch({ type: 'MAKE_POSTER' });
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

      {screen.name === 'upload' ? (
        <UploadState
          headingRef={headingRef}
          screen={screen}
          units={prefs.units}
          onFile={chooseFile}
          onSample={chooseSample}
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
        />
      ) : null}

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
