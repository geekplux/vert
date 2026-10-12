/**
 * The poster output sizes (DESIGN-SPEC §4): the one list the size picker, the page state and the
 * export read. Print sizes are 300 dpi.
 */

/** One poster output size. `width` and `height` are the export's pixel targets. */
export interface PosterSize<Id extends string = string> {
  id: Id;
  /** Shown on the first line, e.g. "18 × 24 in". */
  name: string;
  use: 'print' | 'social' | 'story';
  width: number;
  height: number;
}

/** The four poster sizes, in display order. */
export const POSTER_SIZES = [
  { id: '18x24', name: '18 × 24 in', use: 'print', width: 5400, height: 7200 },
  { id: 'a3', name: 'A3', use: 'print', width: 3508, height: 4961 },
  { id: '4x5', name: '4 : 5', use: 'social', width: 1080, height: 1350 },
  { id: '9x16', name: '9 : 16', use: 'story', width: 1080, height: 1920 },
] as const satisfies readonly PosterSize[];

export type PosterSizeId = (typeof POSTER_SIZES)[number]['id'];

type PosterSizeEntry<Id extends PosterSizeId> = Extract<(typeof POSTER_SIZES)[number], { id: Id }>;

/** The size with this id. */
export function posterSizeById<Id extends PosterSizeId>(id: Id): PosterSizeEntry<Id> {
  const size = POSTER_SIZES.find(
    (candidate): candidate is PosterSizeEntry<Id> => candidate.id === id,
  );
  if (!size) throw new RangeError(`Unknown poster size: ${id}`);
  return size;
}
