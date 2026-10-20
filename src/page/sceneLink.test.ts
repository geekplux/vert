import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeScene } from '../scene/decode';
import { RunLoadError } from './errors';
import {
  SCENE_MAX_BYTES,
  fetchScene,
  forgetSceneParam,
  parseSceneParam,
  sceneFileName,
  sceneName,
  sceneTitle,
} from './sceneLink';
import type { FetchLike } from './sceneLink';

const FIXTURE = new Uint8Array(
  readFileSync(join(import.meta.dirname, '../scene/fixtures/coosa-backcountry.scene')),
);
const SCENE_URL = new URL('https://activities.geekplux.org/terrain/coosa-backcountry.scene');

function okResponse(body: BodyInit | null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

/** A fetch that answers `response` and records what it was asked. */
function fakeFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn<FetchLike>(() =>
    typeof response === 'function' ? response() : Promise.resolve(response),
  );
}

async function failure(promise: Promise<unknown>): Promise<RunLoadError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error('expected the load to fail');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RunLoadError);
  return error as RunLoadError;
}

describe('parseSceneParam', () => {
  it('is null without a parameter or with an empty one', () => {
    expect(parseSceneParam(null)).toBeNull();
    expect(parseSceneParam('')).toBeNull();
    expect(parseSceneParam('   ')).toBeNull();
  });

  it('takes an absolute https URL, query and all', () => {
    const parsed = parseSceneParam(
      'https://activities.geekplux.org/terrain/16123456789.scene?v=1a2b3c4d',
    );
    expect(parsed && 'url' in parsed ? parsed.url.href : parsed).toBe(
      'https://activities.geekplux.org/terrain/16123456789.scene?v=1a2b3c4d',
    );
  });

  it('takes plain http only for this computer', () => {
    for (const value of [
      'http://localhost:4173/samples/coosa-backcountry.scene',
      'http://127.0.0.1:5173/x.scene',
      'http://[::1]/x.scene',
    ]) {
      expect(parseSceneParam(value), value).toHaveProperty('url');
    }
    expect(parseSceneParam('http://example.com/x.scene')).toEqual({
      error: 'Could not open that scene: only https links can be opened.',
    });
    expect(parseSceneParam('http://localhost.example.com/x.scene')).toHaveProperty('error');
  });

  it('refuses other schemes, relative paths and non-URLs with a sentence', () => {
    expect(parseSceneParam('ftp://example.com/x.scene')).toEqual({
      error: 'Could not open that scene: only https links can be opened.',
    });
    expect(parseSceneParam('javascript:alert(1)')).toHaveProperty('error');
    expect(parseSceneParam('data:application/octet-stream;base64,AAAA')).toHaveProperty('error');
    expect(parseSceneParam('/samples/coosa-backcountry.scene')).toEqual({
      error: 'Could not open that scene: the link is not a full web address.',
    });
    expect(parseSceneParam('not a url')).toHaveProperty('error');
  });

  it('refuses a user name or password in the link', () => {
    expect(parseSceneParam('https://user:secret@example.com/x.scene')).toEqual({
      error: 'Could not open that scene: the link carries a user name or password.',
    });
  });
});

describe('sceneName and sceneFileName', () => {
  it('names the scene after its file, else its host', () => {
    expect(sceneName(SCENE_URL)).toBe('coosa-backcountry');
    expect(sceneFileName(SCENE_URL)).toBe('coosa-backcountry.scene');
    expect(sceneName(new URL('https://example.com/a/b/Mont%20Blanc.scene?v=1'))).toBe('Mont Blanc');
    expect(sceneName(new URL('https://example.com/a/%E0%A4%A.scene'))).toBe('%E0%A4%A');
    expect(sceneName(new URL('https://example.com/'))).toBe('example.com');
    // Sanitised as a title: whitespace and controls collapse, 80 characters at most.
    const long = encodeURIComponent(`a\nb\u000bc\u202e${'d'.repeat(200)}`);
    expect(sceneName(new URL(`https://example.com/${long}.scene`))).toBe(`a b c${'d'.repeat(75)}`);
    expect(sceneName(new URL('https://example.com/%20%0A.scene'))).toBe('example.com');
    expect(sceneFileName(new URL('https://example.com/'))).toBe('example.com');
  });
});

describe('sceneTitle', () => {
  it('is null without a title or with only whitespace', () => {
    expect(sceneTitle(null)).toBeNull();
    expect(sceneTitle('')).toBeNull();
    expect(sceneTitle(' \t\n ')).toBeNull();
    expect(sceneTitle('\u0000\u0007')).toBeNull();
  });

  it('trims, collapses whitespace and drops control characters', () => {
    expect(sceneTitle('  Translantau   50 ')).toBe('Translantau 50');
    expect(sceneTitle('Lantau\n\t2 Peaks\u0000 Night')).toBe('Lantau 2 Peaks Night');
    expect(sceneTitle('Sunset\u00a0Peak')).toBe('Sunset Peak');
  });

  it('drops format characters, so nothing can reverse or hide text', () => {
    expect(sceneTitle('Lantau\u202e50')).toBe('Lantau50');
    expect(sceneTitle('Tai\u200bMo\u200dShan\u2066x\u2069')).toBe('TaiMoShanx');
    expect(sceneTitle('\u200b\u202e')).toBeNull();
  });

  it('keeps markup as plain text, unchanged', () => {
    expect(sceneTitle('<b>bold</b> & <script>x</script>')).toBe('<b>bold</b> & <script>x</script>');
  });

  it('cuts at 80 characters (code points, so no half emoji), then trims', () => {
    expect(sceneTitle('a'.repeat(100))).toBe('a'.repeat(80));
    expect(sceneTitle(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79));
    const emoji = sceneTitle('⛰️'.repeat(60)) ?? '';
    expect(Array.from(emoji)).toHaveLength(80);
    expect(sceneTitle('🏔'.repeat(90))).toBe('🏔'.repeat(80));
  });
});

describe('SCENE_MAX_BYTES', () => {
  it('is the largest file the five known sections can make: about 10.2 MB', () => {
    // 12 + 5 × 8 + GRID (20 + 7,350,272) + ROUT (16 + 4 × 700,977) + MARK 52 + CLMB 3,826 + SUMM 8
    expect(SCENE_MAX_BYTES).toBe(10_158_154);
    expect(FIXTURE.byteLength).toBeLessThan(SCENE_MAX_BYTES / 200);
  });
});

describe('fetchScene', () => {
  it('fetches with CORS, no credentials and no referrer, and decodes the scene', async () => {
    const fetch = fakeFetch(okResponse(FIXTURE));
    const { scene, host } = await fetchScene(SCENE_URL, new AbortController().signal, fetch);
    expect(scene.summary).toEqual(decodeScene(FIXTURE).summary);
    // A Response built in a test has no url: the link's host.
    expect(host).toBe('activities.geekplux.org');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(input).toBe(SCENE_URL.href);
    expect(init).toMatchObject({
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it('names the host that served the file after a redirect', async () => {
    const response = okResponse(FIXTURE);
    Object.defineProperty(response, 'url', {
      value: 'https://cdn.example.net/x/coosa-backcountry.scene',
    });
    const { host } = await fetchScene(SCENE_URL, new AbortController().signal, fakeFetch(response));
    expect(host).toBe('cdn.example.net');
  });

  it('says what the server answered for an HTTP error', async () => {
    const fetch = fakeFetch(new Response('Not found', { status: 404 }));
    const error = await failure(fetchScene(SCENE_URL, new AbortController().signal, fetch));
    expect(error.message).toBe('Could not open that scene: the server answered 404.');
  });

  it('reports a network or CORS failure (a TypeError) in plain words', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(fetchScene(SCENE_URL, new AbortController().signal, fetch));
    expect(error.message).toBe(
      'Could not open that scene: the server could not be reached, or it does not let other sites read the file (CORS).',
    );
  });

  it('says bytes that are not a scene are not one (the SPA fallback page, say)', async () => {
    const html = '<!doctype html><html lang="en"><title>Activities</title></html>';
    const fetch = fakeFetch(okResponse(html, { 'content-type': 'text/html' }));
    const error = await failure(fetchScene(SCENE_URL, new AbortController().signal, fetch));
    expect(error.message).toBe('Could not open that scene: the file is not a Vert scene.');
  });

  it('tells a newer format and a damaged file apart', async () => {
    const newer = FIXTURE.slice();
    newer[4] = 2;
    const fetchNewer = fakeFetch(okResponse(newer));
    expect(
      (await failure(fetchScene(SCENE_URL, new AbortController().signal, fetchNewer))).message,
    ).toBe(
      'Could not open that scene: it is a newer scene format than this version of Vert reads.',
    );
    const fetchCut = fakeFetch(okResponse(FIXTURE.slice(0, 1000)));
    expect(
      (await failure(fetchScene(SCENE_URL, new AbortController().signal, fetchCut))).message,
    ).toBe('Could not open that scene: the scene file is damaged.');
  });

  it('refuses a file whose declared length is over the cap without reading it', async () => {
    const cancel = vi.fn<(reason?: unknown) => Promise<void>>(() => Promise.resolve());
    const body = new ReadableStream<Uint8Array>({
      pull: () => {
        throw new Error('the body was read');
      },
      cancel,
    });
    const fetch = fakeFetch(okResponse(body, { 'content-length': String(SCENE_MAX_BYTES + 1) }));
    const error = await failure(fetchScene(SCENE_URL, new AbortController().signal, fetch));
    expect(error.message).toBe(
      'Could not open that scene: the file is larger than a scene can be (10.2 MB).',
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('stops reading a body that grows past the cap (no length, or a wrong one)', async () => {
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    const cancel = vi.fn<(reason?: unknown) => Promise<void>>(() => Promise.resolve());
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        // Far more than the cap if nobody stops it.
        if (sent > 50_000_000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel,
    });
    const fetch = fakeFetch(okResponse(body, { 'content-length': '43115' }));
    const error = await failure(fetchScene(SCENE_URL, new AbortController().signal, fetch));
    expect(error.message).toMatch(/larger than a scene can be/);
    expect(cancel).toHaveBeenCalled();
    expect(sent).toBeLessThan(SCENE_MAX_BYTES + 3 * chunk.byteLength);
  });

  it('passes an abort through, not as a load error', async () => {
    const controller = new AbortController();
    const fetch = fakeFetch(() => {
      controller.abort();
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
    const error: unknown = await fetchScene(SCENE_URL, controller.signal, fetch).catch(
      (caught: unknown) => caught,
    );
    expect(error).not.toBeInstanceOf(RunLoadError);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('forgetSceneParam', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('takes ?scene= out of the address bar and keeps the rest, with no new history entry', () => {
    window.history.replaceState(
      null,
      '',
      '/?units=mi&scene=https%3A%2F%2Fx.org%2Fa.scene&title=Translantau%2050#top',
    );
    const length = window.history.length;
    forgetSceneParam();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/?units=mi#top',
    );
    expect(window.history.length).toBe(length);
  });

  it('leaves an address without the parameter alone', () => {
    window.history.replaceState(null, '', '/');
    const replace = vi.spyOn(window.history, 'replaceState');
    forgetSceneParam();
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });
});

describe('the sample scene the site serves', () => {
  it('is the library fixture, byte for byte (e2e opens it with ?scene=)', () => {
    const served = new Uint8Array(
      readFileSync(join(import.meta.dirname, '../../public/samples/coosa-backcountry.scene')),
    );
    expect(served).toEqual(FIXTURE);
  });
});
