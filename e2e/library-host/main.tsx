/**
 * A host page for the built library (e2e/library-host.spec.ts): it imports `dist-lib`'s files as a
 * vendoring host would (`vert-lib` is an alias for the freshly built folder), fetches the committed
 * Coosa scene as a static file, and shows it on a dark page that sets Vert's tokens on a wrapper
 * (README.md's example). With `#dialog-read-only` or `#dialog-synced` it shows instead a profile in a
 * modal `<dialog>`: read-only (controlled, no `onScrub`) or synced (`onScrub` sets `scrub`), to
 * check what Escape does in a browser's own dialog.
 */
import { useEffect, useRef, useState } from 'react';
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
  const [scrub, setScrub] = useState<number | null>(scene.route.distance[0] ?? 0);
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

/** The profile in a modal dialog, at 5 km, read-only or synced. */
function InDialog({ scene, synced }: { scene: Scene; synced: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scrub, setScrub] = useState<number | null>(5_000);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="Elevation of the run"
      style={{ background: '#111214', color: '#e6edf3', width: 'min(900px, 90vw)' }}
    >
      <div className="vert-host">
        <ElevationProfile scene={scene} scrub={scrub} onScrub={synced ? setScrub : undefined} />
      </div>
    </dialog>
  );
}

const credit = document.getElementById('credit');
if (credit) credit.textContent = `Elevation: ${TERRAIN_ATTRIBUTION}`;
const root = document.getElementById('vert');
void fetch(sceneUrl)
  .then((response) => response.arrayBuffer())
  .then((buffer) => {
    const scene = decodeScene(new Uint8Array(buffer));
    const dialog = /^#dialog-(read-only|synced)$/.exec(window.location.hash)?.[1];
    if (root) {
      createRoot(root).render(
        dialog ? <InDialog scene={scene} synced={dialog === 'synced'} /> : <Vert scene={scene} />,
      );
    }
  });
