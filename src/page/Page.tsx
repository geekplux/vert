import { useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { Button } from '../components';
import { AboutDialog } from './AboutDialog/AboutDialog';
import { AppHeader } from './AppHeader/AppHeader';
import { PosterNav } from './AppHeader/PosterNav';
import { UploadNav } from './AppHeader/UploadNav';
import { ViewNav } from './AppHeader/ViewNav';
import { RunProvider, useRun, useRunChooser } from './hooks';
import type { RunProviderProps } from './hooks';
import { usePageState } from './state';
import type { PageAction, PageState, Screen } from './state';
import { UploadState } from './UploadState/UploadState';
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
          screen={screen}
          units={prefs.units}
          onFile={chooseFile}
          onSample={chooseSample}
        />
      ) : (
        <Placeholder screen={screen} dispatch={dispatch} onNewFile={newFile} />
      )}

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

const PLACEHOLDER_NAMES = { view: 'View', poster: 'Poster mode', exporting: 'Exporting' } as const;

/**
 * PHASE 2 PLACEHOLDER for the View, Poster and Exporting states (tasks d–f replace it): the
 * screen's name and a way on (View: the header's New file; Poster mode: New file here;
 * Exporting: Cancel), so the flow can be clicked through.
 */
function Placeholder({
  screen,
  dispatch,
  onNewFile,
}: {
  screen: Exclude<Screen, { name: 'upload' }>;
  dispatch: Dispatch<PageAction>;
  onNewFile: () => void;
}) {
  return (
    <main className={styles.placeholder}>
      <h1 className={styles.placeholderTitle}>{PLACEHOLDER_NAMES[screen.name]}</h1>
      <p className={styles.placeholderText}>Placeholder: this state is built in a later task.</p>
      {/* View has New file in its header already; Poster mode's header only goes back. */}
      {screen.name === 'poster' ? (
        <Button variant="secondary" onClick={onNewFile}>
          New file
        </Button>
      ) : screen.name === 'exporting' ? (
        <Button
          variant="quiet"
          onClick={() => {
            dispatch({ type: 'EXPORT_CANCELLED' });
          }}
        >
          Cancel
        </Button>
      ) : null}
    </main>
  );
}
