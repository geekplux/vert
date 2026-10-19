import { TOUCH_SLOP } from '../lib/touch';

/**
 * Keeps a vertical one-finger swipe over the terrain from tilting the view, so on a phone it
 * scrolls the page instead (DECISIONS.md "Library 7: host feedback"). The view and its canvas
 * take `touch-action: pan-y`, so the browser scrolls on a vertical swipe; but Chromium first
 * delivers the pointerdown and a few pointermoves (about 21–25 px) before its `pointercancel`, and
 * three.js's OrbitControls would turn them into a tilt.
 *
 * Installed on an ancestor of the canvas, in the capture phase, it holds back (stops the
 * propagation of) each single finger's `pointermove`s until the gesture is clearly sideways (more
 * than {@link TOUCH_SLOP} px across, and more across than down); a gesture that goes down first stays held
 * until it ends. Everything else passes untouched: pointerdown, pointerup and pointercancel (so
 * the controls track and release the finger), every move once a second finger is down (pinch
 * zoom), and mouse and pen. OrbitControls listens for moves on the document while a pointer is
 * down, so stopping them on their way down to the canvas keeps them from it.
 *
 * Ported from Activities' `src/vert/holdTouch.ts`, which first solved it for a host page.
 *
 * @returns the function that removes it.
 */
export function holdVerticalTouch(target: EventTarget): () => void {
  const fingers = new Map<number, { x: number; y: number; pass: boolean; held: boolean }>();
  const onDown = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, pass: false, held: false });
    // Two fingers: a pinch, never held.
    if (fingers.size > 1) for (const finger of fingers.values()) finger.pass = true;
  };
  const onMove = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType !== 'touch') return;
    const finger = fingers.get(e.pointerId);
    if (!finger || finger.pass) return;
    const dx = Math.abs(e.clientX - finger.x);
    const dy = Math.abs(e.clientY - finger.y);
    if (!finger.held && dx > TOUCH_SLOP && dx > dy) {
      finger.pass = true;
      return;
    }
    if (dy > TOUCH_SLOP && dy >= dx) finger.held = true;
    e.stopPropagation();
  };
  const onEnd = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType === 'touch') fingers.delete(e.pointerId);
  };
  const options = { capture: true };
  target.addEventListener('pointerdown', onDown, options);
  target.addEventListener('pointermove', onMove, options);
  target.addEventListener('pointerup', onEnd, options);
  target.addEventListener('pointercancel', onEnd, options);
  return () => {
    target.removeEventListener('pointerdown', onDown, options);
    target.removeEventListener('pointermove', onMove, options);
    target.removeEventListener('pointerup', onEnd, options);
    target.removeEventListener('pointercancel', onEnd, options);
  };
}
