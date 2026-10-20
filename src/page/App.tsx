import { Page } from './Page';
import { SCENE_PARAM, TITLE_PARAM } from './sceneLink';

/**
 * The app: the one page (`Page`), starting on Upload, or opening the scene a link names
 * (`?scene=<url>`, with an optional `&title=<text>`, src/page/sceneLink.ts).
 */
export function App() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  return <Page sceneParam={params.get(SCENE_PARAM)} titleParam={params.get(TITLE_PARAM)} />;
}
