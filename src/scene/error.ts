/**
 * Why a `.scene` file could not be read (docs/SCENE.md, "Decoding"):
 *
 * - `magic`: the file does not start with the scene magic (not a scene at all);
 * - `version`: a format version this decoder does not know (a newer file);
 * - `truncated`: the file ends before a header, section or stream does;
 * - `range`: a value outside its documented range (a size, a count, an elevation, a distance);
 * - `length`: lengths that disagree (the header's byte length, a section's length and what its
 *   fields take, a missing or repeated section);
 * - `corrupt`: anything else that cannot come from a valid writer (non-zero reserved bits or
 *   padding, a bad Rice parameter, markers or climbs that break the format's rules).
 */
export type SceneErrorReason = 'magic' | 'version' | 'truncated' | 'range' | 'length' | 'corrupt';

/** Thrown by `decodeScene` for any input that is not a valid scene. */
export class SceneError extends Error {
  readonly reason: SceneErrorReason;
  constructor(reason: SceneErrorReason, message: string) {
    super(message);
    this.name = 'SceneError';
    this.reason = reason;
  }
}
