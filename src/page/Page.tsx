import { useEffect, useRef, useState } from 'react';
import type { Dispatch, Ref, RefObject } from 'react';
import { Button } from '../components';
import { AboutDialog } from './AboutDialog/AboutDialog';
import { AppHeader } from './AppHeader/AppHeader';
import { PosterNav } from './AppHeader/PosterNav';
import { UploadNav } from './AppHeader/UploadNav';
import { ViewNav } from './AppHeader/ViewNav';
import { RunProvider, useRun, useRunChooser } from './hooks';
import type { RunProviderProps } from './hooks';
import { isPosterMode, usePageState } from './state';
import type { PageAction, PageState, Screen } from './state';
import { UploadState } from './UploadState/UploadState';
import { ViewState } from './ViewState/ViewState';
import styles from './Page.module.css';

export interface PageProps extends Omit<RunProviderProps, 'children'> {
  /** Start in a given state (stories and tests); the app starts on Upload with default prefs. */
  initialState?: PageState;
  /** Open the About dialog on first render (stories only). */
  initialAboutOpen?: boolean;
}

/**
 * The one page (DESIGN-SPEC §3): the header with the current state's controls, then the current
 * state. Owns the state machine (`usePageState`) inside `RunProvider`.
 */
export function Page({ initialState, initialAboutOpen = false, ...runProps }: PageProps) {
  return (
    <RunProvider {...runProps}>
      <PageContent initialState={initialState} initialAboutOpen={initialAboutOpen} />
    </RunProvider>
  );
}

function PageContent({
  initialState,
  initialAboutOpen,
}: {
  initialState?: PageState;
  initialAboutOpen: boolean;
}) {
  const { state, dispatch } = usePageState(initialState);
  // `newFile` is ignored while a load is in flight and forgets the run (hooks.ts).
  const { chooseFile, chooseSample, newFile } = useRunChooser(dispatch);
  const run = useRun();
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const { screen, prefs } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Exporting is an overlay on poster mode, not a new screen (its focus is task f's).
  useFocusOnScreenChange(isPosterMode(screen) ? 'poster' : screen.name, headingRef);

  return (
    <div className={styles.page}>
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
          onExaggerationChange={(value) => {
            dispatch({ type: 'SET_EXAGGERATION', value });
          }}
        />
      ) : screen.name !== 'view' ? (
        // (View always has a run: RUN_LOADED brings it, and New file leaves View as it clears it.)
        <Placeholder
          headingRef={headingRef}
          screen={screen}
          dispatch={dispatch}
          onNewFile={newFile}
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

const PLACEHOLDER_NAMES = { poster: 'Poster mode', exporting: 'Exporting' } as const;

/**
 * PHASE 2 PLACEHOLDER for the Poster and Exporting states (tasks e–f replace it): the screen's
 * name and a way on (Poster mode: New file here; Exporting: Cancel), so the flow can be clicked
 * through.
 */
function Placeholder({
  headingRef,
  screen,
  dispatch,
  onNewFile,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  screen: Exclude<Screen, { name: 'upload' | 'view' }>;
  dispatch: Dispatch<PageAction>;
  onNewFile: () => void;
}) {
  return (
    <main className={styles.placeholder}>
      <h1 ref={headingRef} tabIndex={-1} className={styles.placeholderTitle}>
        {PLACEHOLDER_NAMES[screen.name]}
      </h1>
      <p className={styles.placeholderText}>Placeholder: this state is built in a later task.</p>
      {/* Poster mode's header only goes back. */}
      {screen.name === 'poster' ? (
        <Button variant="secondary" onClick={onNewFile}>
          New file
        </Button>
      ) : (
        <Button
          variant="quiet"
          onClick={() => {
            dispatch({ type: 'EXPORT_CANCELLED' });
          }}
        >
          Cancel
        </Button>
      )}
    </main>
  );
}
