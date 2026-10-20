/**
 * Opening a baked scene from a link (DECISIONS "Page: open a scene by URL"): the page loads with
 * `?scene=<absolute URL of a .scene file>`, fetches it and shows it in the View, as if a GPX had
 * been dropped and read. One query parameter; nothing is typed, stored or sent anywhere else.
 *
 * - `parseSceneParam` checks the parameter: an absolute `https:` URL (`http:` only for
 *   localhost, for development), with no user name or password in it.
 * - `fetchScene` fetches it with CORS and no credentials, refuses a body over `SCENE_MAX_BYTES`
 *   (the largest file the format's known sections can make) before and while reading it, and
 *   decodes it. Every failure is a `RunLoadError` whose message is one plain sentence, "Could not
 *   open that scene: …", which the Upload screen shows above its Dropzone.
 */
import { SceneError } from '../scene/error';
import {
  CLIMB_BYTES,
  HEADER_BYTES,
  MARKER_BYTES,
  SCENE_LIMITS,
  SECTION_HEADER_BYTES,
} from '../scene/format';
import type { Scene } from '../scene/types';
import { RunLoadError } from './errors';

/** The query parameter: `https://vert.geekplux.org/?scene=<absolute scene URL>`. */
export const SCENE_PARAM = 'scene';

/** Every message starts so; the reason follows in plain words. */
export const SCENE_ERROR_PREFIX = 'Could not open that scene:';

/** The message for a failure that has no reason of its own to give. */
export const SCENE_GENERIC_ERROR = 'Could not open that scene.';

const sentence = (reason: string) => `${SCENE_ERROR_PREFIX} ${reason}`;

/**
 * Bytes a stream of `count` values can take at most (docs/SCENE.md, "Streams"): a 5-bit Rice
 * parameter per block of 64, and each value at its longest, an escape (24 one-bits and 32 bits;
 * a value that is not escaped takes at most 23 + 1 + 24 = 48), padded to a whole byte.
 */
function maxStreamBytes(count: number): number {
  return Math.ceil((Math.ceil(count / 64) * 5 + count * 56) / 8);
}

/**
 * The largest version-1 scene made of its five known sections, every size at its limit and every
 * stream value escaped: about 10.2 MB (the Coosa sample is 43 KB). A file over it is refused
 * before it is read; so is a body that grows past it while it is read.
 */
export const SCENE_MAX_BYTES =
  HEADER_BYTES +
  5 * SECTION_HEADER_BYTES +
  // GRID: 20 bytes of fields, then one stream of width × height levels.
  20 +
  maxStreamBytes(SCENE_LIMITS.maxGridSide * SCENE_LIMITS.maxGridSide) +
  // ROUT: 16 bytes of fields, then x, y, elevation and time, one stream each.
  16 +
  4 * maxStreamBytes(SCENE_LIMITS.maxRoutePoints) +
  // MARK: a count and three records; CLMB: a count and up to 255 records; SUMM: 8 bytes.
  1 +
  3 * MARKER_BYTES +
  1 +
  SCENE_LIMITS.maxClimbs * CLIMB_BYTES +
  8;

/** Hosts a plain `http:` link may name: this computer, for development. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The parameter, checked: the URL to fetch, or why it cannot be opened. */
export type SceneParam = { readonly url: URL } | { readonly error: string };

/**
 * `?scene=` as the page received it (`URLSearchParams.get`, already percent-decoded), or `null`
 * when there is none. An empty value counts as none.
 */
export function parseSceneParam(value: string | null): SceneParam | null {
  if (value === null || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: sentence('the link is not a full web address.') };
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    return { error: sentence('only https links can be opened.') };
  }
  // fetch() refuses such a URL anyway; say why instead of failing as a network error.
  if (url.username !== '' || url.password !== '') {
    return { error: sentence('the link carries a user name or password.') };
  }
  return { url };
}

/**
 * The scene's name for its h1: the file name without `.scene` ("coosa-backcountry"), else the
 * host. The format carries no title (names are forbidden content, docs/SCENE.md).
 */
export function sceneName(url: URL): string {
  const last = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed escape: keep the segment as it is.
  }
  name = name.replace(/\.scene$/i, '').trim();
  return name === '' ? url.hostname : name;
}

/** The file name the Upload screen shows while it reads ("Reading coosa-backcountry.scene…"). */
export function sceneFileName(url: URL): string {
  const name = sceneName(url);
  return name === url.hostname ? name : `${name}.scene`;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Fetches and decodes a scene from its URL (`LoadScene` in hooks.ts). */
export type LoadScene = (url: URL, signal: AbortSignal) => Promise<Scene>;

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
}

const TOO_BIG = sentence(
  `the file is larger than a scene can be (${(SCENE_MAX_BYTES / 1e6).toFixed(1)} MB).`,
);

/** The body's bytes, refused (and the download cancelled) once it passes `max`. */
async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > max) throw new RunLoadError(TOO_BIG);
    return new Uint8Array(buffer);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel().catch(() => undefined);
      throw new RunLoadError(TOO_BIG);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeError(error: SceneError): string {
  switch (error.reason) {
    case 'magic':
      return sentence('the file is not a Vert scene.');
    case 'version':
      return sentence('it is a newer scene format than this version of Vert reads.');
    default:
      return sentence('the scene file is damaged.');
  }
}

/**
 * Fetches `url` and decodes it. CORS, no credentials (no cookies, no HTTP authentication) and no
 * referrer: the scene's host learns only that some page asked for the file. The bytes stay in
 * memory; nothing is stored.
 *
 * Rejects with a `RunLoadError` ("Could not open that scene: …") for a network or CORS failure,
 * an HTTP error, a file over `SCENE_MAX_BYTES` or bytes that are not a valid scene; with the
 * signal's reason when it aborts.
 */
export async function fetchScene(
  url: URL,
  signal: AbortSignal,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<Scene> {
  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch (error: unknown) {
    if (isAbort(error, signal)) throw error;
    // A browser reports a CORS refusal and an unreachable host alike, as a TypeError.
    throw new RunLoadError(
      sentence(
        'the server could not be reached, or it does not let other sites read the file (CORS).',
      ),
    );
  }
  if (!response.ok) {
    throw new RunLoadError(sentence(`the server answered ${String(response.status)}.`));
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > SCENE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new RunLoadError(TOO_BIG);
  }
  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response, SCENE_MAX_BYTES);
  } catch (error: unknown) {
    if (error instanceof RunLoadError || isAbort(error, signal)) throw error;
    throw new RunLoadError(sentence('the download was interrupted.'));
  }
  // The decoder loads only when a link is opened, so Upload's first load stays as light as it was.
  const { decodeScene } = await import('../scene/decode');
  try {
    return decodeScene(bytes);
  } catch (error: unknown) {
    if (error instanceof SceneError) throw new RunLoadError(decodeError(error));
    throw error;
  }
}

/** The app's scene loader: the browser's `fetch`. */
export const realLoadScene: LoadScene = (url, signal) => fetchScene(url, signal);

/**
 * The address bar without `?scene=` (the page left the scene, or opened something else), so a
 * reload does not open it again. Other parameters and the hash stay. No new history entry.
 */
export function forgetSceneParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SCENE_PARAM)) return;
  url.searchParams.delete(SCENE_PARAM);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
