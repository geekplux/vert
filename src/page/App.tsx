import { Page } from './Page';
import { SCENE_PARAM } from './sceneLink';

/**
 * The app: the one page (`Page`), starting on Upload, or opening the scene a link names
 * (`?scene=<url>`, src/page/sceneLink.ts).
 */
export function App() {
  const sceneParam =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get(SCENE_PARAM);
  return <Page sceneParam={sceneParam} />;
}
