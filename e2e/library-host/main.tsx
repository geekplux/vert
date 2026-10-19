/**
 * A host page for the built library (e2e/library-host.spec.ts): it imports `dist-lib`'s files as a
 * vendoring host would (`vert-lib` is an alias for the freshly built folder), fetches the committed
 * Coosa scene as a static file, and shows it on a dark page that sets Vert's tokens on a wrapper
 * (README.md's example).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ElevationProfile,
  TERRAIN_ATTRIBUTION,
  TerrainView,
  decodeScene,
  type Scene,
} from 'vert-lib';
import 'vert-lib/vert.css';
import sceneUrl from '../../src/scene/fixtures/coosa-backcountry.scene?url';

function Vert({ scene }: { scene: Scene }) {
  const [scrub, setScrub] = useState(scene.route.distance[0] ?? 0);
  return (
    <>
      <div className="terrain">
        <TerrainView
          scene={scene}
          exaggeration={1.6}
          scrub={scrub}
          ariaLabel="3D terrain of the Coosa Backcountry Trail"
        />
      </div>
      <ElevationProfile scene={scene} scrub={scrub} onScrub={setScrub} />
    </>
  );
}

const credit = document.getElementById('credit');
if (credit) credit.textContent = `Elevation: ${TERRAIN_ATTRIBUTION}`;
const root = document.getElementById('vert');
void fetch(sceneUrl)
  .then((response) => response.arrayBuffer())
  .then((buffer) => {
    if (root) createRoot(root).render(<Vert scene={decodeScene(new Uint8Array(buffer))} />);
  });
