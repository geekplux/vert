// @vitest-environment node
// The handler runs in the parse worker, so it is tested without jsdom.
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SAMPLE_RUN } from '../page/sample';
import {
  INTERNAL_ERROR_MESSAGE,
  UNTITLED_RUN,
  decodeGpxBytes,
  handleMessage,
  roundOutward,
  runName,
  type ParseRequest,
  type ParseResponse,
} from './handler';
import { GPX_ERROR_MESSAGES } from './types';

const sampleBytes = readFileSync(
  new URL('../../public/samples/coosa-backcountry.gpx', import.meta.url),
);

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function gpx(body: string, attrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" ${attrs}>${body}</gpx>`;
}

const TWO_POINTS = `<trk><trkseg>
  <trkpt lat="45.0" lon="7.0"><ele>1000</ele><time>2026-05-01T06:00:00Z</time></trkpt>
  <trkpt lat="45.001" lon="7.0"><ele>1010</ele><time>2026-05-01T06:00:20Z</time></trkpt>
</trkseg></trk>`;

function ok(response: ParseResponse) {
  if (!response.ok) throw new Error(`Expected ok, got ${response.code}: ${response.message}`);
  return response;
}

describe('handleMessage', () => {
  it('parses the sample bytes into a run and its points, with every buffer transferred', () => {
    const request: ParseRequest = {
      id: 7,
      kind: 'file',
      buffer: bufferOf(sampleBytes),
      fileName: 'coosa-backcountry.gpx',
      isSample: true,
    };
    const { response, transfer } = handleMessage(request);
    const { id, run, points } = ok(response);

    expect(id).toBe(7);
    expect(run).toMatchObject({
      name: 'Coosa Backcountry Trail',
      isSample: true,
      hasTime: true,
      hasElevation: true,
      startTime: Date.parse('2026-10-03T11:10:00Z'),
    });
    expect(run.lonForOffset).toBeCloseTo(-83.926, 3);
    expect(run.distance).toBeCloseTo(21_480, -2);
    expect(run.vert).toBeGreaterThan(1050);
    expect(run.descent).toBeGreaterThan(1050);
    expect(run.elapsedTime).toBeGreaterThan(run.movingTime);
    expect(run.profile).toHaveLength(500);
    expect(run.climbs.length).toBeGreaterThan(0);
    // The placeholder's bounds were written from the same file the same way.
    expect(run.bounds).toEqual(SAMPLE_RUN.bounds);

    const n = points.lat.length;
    expect(n).toBe(5623);
    for (const series of [points.lon, points.ele, points.cumulative, points.time]) {
      expect(series).toBeInstanceOf(Float64Array);
      expect(series).toHaveLength(n);
    }
    expect(points.cumulative[n - 1]).toBe(run.distance);
    expect(transfer).toHaveLength(5);
    expect(new Set(transfer)).toEqual(
      new Set(
        [points.lat, points.lon, points.ele, points.cumulative, points.time].map((a) => a?.buffer),
      ),
    );

    // The response is plain data: it survives structured cloning with its buffers transferred.
    const cloned = structuredClone<ParseResponse>(response, { transfer });
    expect(cloned).toMatchObject({ id: 7, ok: true });
    expect(points.lat.length).toBe(0); // detached by the transfer
  });

  it('accepts text, with or without a byte-order mark', () => {
    const plain = ok(
      handleMessage({ id: 1, kind: 'text', text: gpx(TWO_POINTS), fileName: 'a.gpx' }).response,
    );
    const bom = ok(
      handleMessage({
        id: 2,
        kind: 'text',
        text: String.fromCharCode(0xfeff) + gpx(TWO_POINTS),
        fileName: 'a.gpx',
      }).response,
    );
    expect(bom.run.distance).toBe(plain.run.distance);
    expect(plain.run).toMatchObject({ name: 'A', isSample: false, hasTime: true });
    expect(plain.run.distance).toBeCloseTo(111.2, 1);
    expect(plain.run.movingTime).toBe(20);
  });

  it('reports the parser’s error code and message', () => {
    const notGpx = handleMessage({ id: 3, kind: 'text', text: '<kml></kml>', fileName: 'x.gpx' });
    expect(notGpx).toEqual({
      response: { id: 3, ok: false, code: 'not-gpx', message: GPX_ERROR_MESSAGES['not-gpx'] },
      transfer: [],
    });
    const empty = handleMessage({
      id: 4,
      kind: 'text',
      text: gpx('<trk></trk>'),
      fileName: 'x.gpx',
    });
    expect(empty.response).toMatchObject({ ok: false, code: 'no-points' });
    const cut = handleMessage({
      id: 5,
      kind: 'text',
      text: gpx(TWO_POINTS).slice(0, 200),
      fileName: 'x.gpx',
    });
    expect(cut.response).toMatchObject({ ok: false, code: 'malformed' });
  });

  it('answers an unexpected failure with the generic message, never throwing', () => {
    const broken = {
      id: 6,
      kind: 'text',
      text: undefined,
      fileName: 'x.gpx',
    } as unknown as ParseRequest;
    expect(handleMessage(broken).response).toEqual({
      id: 6,
      ok: false,
      code: 'internal',
      message: INTERNAL_ERROR_MESSAGE,
    });
  });

  it('marks missing times and elevations as NaN, with the metadata time as the start', () => {
    const text = gpx(`<metadata><time>2026-04-01T08:00:00Z</time></metadata>
      <trk><trkseg><trkpt lat="45" lon="7"/><trkpt lat="45.01" lon="7"/></trkseg></trk>`);
    const { run, points } = ok(
      handleMessage({ id: 8, kind: 'text', text, fileName: 'plan.gpx' }).response,
    );
    expect(run).toMatchObject({ hasTime: false, hasElevation: false, profile: [], climbs: [] });
    expect(run.startTime).toBe(Date.parse('2026-04-01T08:00:00Z'));
    for (const value of [
      run.vert,
      run.descent,
      run.movingTime,
      run.elapsedTime,
      run.highPoint,
      run.lowPoint,
    ]) {
      expect(value).toBeNaN();
    }
    expect(points.ele).toBeNull();
    expect(points.time).toBeNull();

    const bare = gpx(
      '<trk><trkseg><trkpt lat="45" lon="7"/><trkpt lat="45.01" lon="7"/></trkseg></trk>',
    );
    expect(
      ok(handleMessage({ id: 9, kind: 'text', text: bare, fileName: 'p.gpx' }).response).run
        .startTime,
    ).toBeNaN();
  });
});

describe('decodeGpxBytes', () => {
  const doc = gpx('<trk><name>Café Ränne</name></trk>');

  it('reads UTF-8 and drops its BOM', () => {
    const utf8 = new TextEncoder().encode(doc);
    expect(decodeGpxBytes(bufferOf(utf8))).toBe(doc);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeGpxBytes(bufferOf(withBom))).toBe(doc);
  });

  it('falls back to Latin-1 when the bytes are not UTF-8', () => {
    const latin1 = Uint8Array.from(doc, (c) => c.charCodeAt(0));
    expect(decodeGpxBytes(bufferOf(latin1))).toBe(doc);
  });

  it('reads UTF-16 with a byte-order mark', () => {
    const le = new Uint8Array(2 + doc.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < doc.length; i++) {
      le[2 + i * 2] = doc.charCodeAt(i) & 0xff;
      le[3 + i * 2] = doc.charCodeAt(i) >> 8;
    }
    expect(decodeGpxBytes(bufferOf(le))).toBe(doc);
  });

  it('gives the run its name from Latin-1 bytes end to end', () => {
    const text = gpx(`<trk><name>Café</name><trkseg>
      <trkpt lat="45" lon="7"/><trkpt lat="45.01" lon="7"/></trkseg></trk>`).replace(
      'UTF-8',
      'ISO-8859-1',
    );
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const { run } = ok(
      handleMessage({ id: 1, kind: 'file', buffer: bufferOf(bytes), fileName: 'x.gpx' }).response,
    );
    expect(run.name).toBe('Café');
  });
});

describe('runName', () => {
  it('uses the GPX name as written, whitespace collapsed', () => {
    expect(runName('  LUT 20k\n nuova variante 2024 ', 'x.gpx')).toBe(
      'LUT 20k nuova variante 2024',
    );
    expect(runName('morning run', 'x.gpx')).toBe('morning run');
  });

  it('falls back to a readable file name', () => {
    expect(runName(null, 'Morning_Run.gpx')).toBe('Morning Run');
    expect(runName(null, 'morning_run.gpx')).toBe('Morning Run');
    expect(runName(null, 'tour-of-the-hills.GPX')).toBe('Tour of the Hills');
    expect(runName(null, 'long-run-2026-10-03.gpx')).toBe('Long Run 2026-10-03');
    expect(runName(null, 'UTMB_CCC.gpx')).toBe('UTMB CCC');
    expect(runName(null, 'activity_123456.gpx')).toBe('Activity 123456');
    expect(runName('', 'loop.gpx')).toBe('Loop');
    expect(runName(null, '.gpx')).toBe(UNTITLED_RUN);
    expect(runName(null, '___.gpx')).toBe(UNTITLED_RUN);
  });
});

describe('roundOutward', () => {
  it('rounds a bbox outward to 4 decimals', () => {
    expect(
      roundOutward({ west: -83.96061, south: 34.74719, east: -83.92391, north: 34.79371 }),
    ).toEqual({
      west: -83.9607,
      south: 34.7471,
      east: -83.9239,
      north: 34.7938,
    });
  });

  it('keeps values already on the grid, and stays inside the globe', () => {
    expect(roundOutward({ west: 7.1, south: 45.25, east: 7.2, north: 45.5 })).toEqual({
      west: 7.1,
      south: 45.25,
      east: 7.2,
      north: 45.5,
    });
    expect(roundOutward({ west: -180, south: -90, east: 180, north: 90 })).toEqual({
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    });
  });
});
