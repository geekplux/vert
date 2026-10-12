import styles from './App.module.css';
import { AppHeader } from './AppHeader/AppHeader';
import { UploadNav } from './AppHeader/UploadNav';
import { UploadLayout } from './PageShell/UploadLayout';

/**
 * Placeholder until the page states land (PROGRESS.md phase 2): the real header over the Upload
 * layout. The Upload state will own the h1, the Dropzone and the About dialog.
 */
export function App() {
  return (
    <div className={styles.page}>
      <AppHeader state="upload">
        <UploadNav
          onAbout={() => {
            // The About dialog arrives with the Upload state.
          }}
        />
      </AppHeader>
      <UploadLayout left={<h1>Your run, as terrain.</h1>} right={null} />
    </div>
  );
}
