/**
 * A stand-in for `src/terrain/TerrainView` in page tests (jsdom has no WebGL). Use it with
 * `vi.mock('<path to>/terrain/TerrainView', () => import('<path to>/test/fakeTerrainView'))`.
 *
 * It renders what the real view's accessibility tree has (a focusable wrapper around a `role="img"`
 * canvas with the label), records every render's props in `fakeTerrainView.props`, exposes a spy
 * `rotateBy` through its ref, and reports its first frame per heightfield like the real one (turn
 * that off with `fakeTerrainView.ready = false`). `fakeTerrainView.fail = true` makes it throw like
 * a browser without WebGL.
 */
import { useEffect, useImperativeHandle } from 'react';
import { vi } from 'vitest';
import type { TerrainViewProps } from '../terrain/TerrainView';

export const fakeTerrainView = {
  props: [] as TerrainViewProps[],
  rotateBy: vi.fn<(radians: number) => void>(),
  /** The focusable wrapper of the latest render. */
  element: null as HTMLDivElement | null,
  ready: true,
  fail: false,
  /** What a failing view throws (default: a WebGL error). */
  error: null as Error | null,
  reset() {
    this.props.length = 0;
    this.rotateBy.mockClear();
    this.element = null;
    this.ready = true;
    this.fail = false;
    this.error = null;
  },
  /** The props of the latest render. */
  last(): TerrainViewProps {
    const props = this.props.at(-1);
    if (!props) throw new Error('TerrainView was not rendered');
    return props;
  },
};

export function TerrainView(props: TerrainViewProps) {
  const { ref, onReady, heightfield, ariaLabel, className } = props;
  fakeTerrainView.props.push(props);
  useImperativeHandle(
    ref,
    () => ({
      rotateBy: fakeTerrainView.rotateBy,
      resetView: () => undefined,
      requestRender: () => undefined,
      focus: () => fakeTerrainView.element?.focus(),
      stage: null,
    }),
    [],
  );
  useEffect(() => {
    if (fakeTerrainView.ready && heightfield) onReady?.();
    // Like the real view: once per new heightfield.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightfield]);
  if (fakeTerrainView.fail) {
    throw fakeTerrainView.error ?? new Error('Error creating WebGL context.');
  }
  return (
    <div
      ref={(element) => {
        fakeTerrainView.element = element;
      }}
      className={className}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- as the real view
      tabIndex={heightfield ? 0 : -1}
    >
      {/* eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role -- as the real view */}
      <canvas role="img" aria-label={ariaLabel} />
    </div>
  );
}
