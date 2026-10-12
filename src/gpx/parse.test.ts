// @vitest-environment node
// The parser runs in a Web Worker, so it is tested without jsdom: any DOM use would fail here.
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { parseGpx, parseIsoTime } from './parse';
import { GpxError, type GpxErrorCode } from './types';

function readFixture(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const sample = readFixture('../../public/samples/coosa-backcountry.gpx');

/** Wraps a body in a minimal GPX 1.1 root. */
function gpx(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;
}

/** Runs `parse` and returns the GpxError code it throws (failing the test if it does not throw). */
function errorCode(parse: () => unknown): GpxErrorCode {
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(GpxError);
    const gpxError = error as GpxError;
    expect(gpxError.message).not.toBe('');
    return gpxError.code;
  }
  throw new Error('Expected a GpxError');
}

const iso = (value: string): number => Date.parse(value);

describe('parseGpx: the bundled sample', () => {
  const parsed = parseGpx(sample);

  it('reads every point of the track', () => {
    expect(parsed.points).toHaveLength(5623);
    expect(parsed.source).toBe('trk');
    expect(parsed.segments).toBe(1);
  });

  it('reads the metadata', () => {
    expect(parsed.name).toBe('Coosa Backcountry Trail');
    expect(parsed.type).toBe('trail_running');
    expect(parsed.creator).toBe('Vert sample generator');
    expect(parsed.time).toBe(iso('2026-10-03T11:10:00Z'));
  });

  it('reads the first and last points exactly', () => {
    expect(parsed.points[0]).toEqual({
      lat: 34.7637553,
      lon: -83.9263951,
      ele: 708.6,
      time: iso('2026-10-03T11:10:00Z'),
    });
    expect(parsed.points.at(-1)?.time).toBe(iso('2026-10-03T14:17:24Z'));
  });

  it('parses the 722 KB sample quickly', () => {
    const start = performance.now();
    parseGpx(sample);
    const elapsed = performance.now() - start;
    // Typically a few ms; the bound is loose so a slow CI machine does not flake.
    expect(elapsed).toBeLessThan(250);
  });
});

describe('parseGpx: real-world exports', () => {
  it('reads a Strava export and skips heart-rate and cadence extensions', () => {
    const parsed = parseGpx(readFixture('./fixtures/strava.gpx'));
    expect(parsed).toMatchObject({
      name: 'Afternoon Trail Run',
      type: 'running',
      creator: 'StravaGPX',
      time: iso('2024-05-18T13:02:11Z'),
      segments: 1,
      source: 'trk',
    });
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[2]).toEqual({
      lat: 37.865189,
      lon: -119.538221,
      ele: 1220.6,
      time: iso('2024-05-18T13:02:13Z'),
    });
  });

  it('reads a Garmin export with namespaced TrackPointExtension and ignores waypoints', () => {
    const parsed = parseGpx(readFixture('./fixtures/garmin.gpx'));
    expect(parsed).toMatchObject({
      name: 'Lake Placid Trail Running',
      type: 'trail_running',
      creator: 'Forerunner 965',
      time: iso('2025-08-09T06:30:12Z'),
    });
    expect(parsed.points).toEqual([
      {
        lat: 44.279503,
        lon: -73.9799185,
        ele: 567.4000244140625,
        time: iso('2025-08-09T06:30:12Z'),
      },
      {
        lat: 44.2795812,
        lon: -73.9798106,
        ele: 567.79998779296875,
        time: iso('2025-08-09T06:30:13Z'),
      },
    ]);
  });

  it('reads gpx:-prefixed elements, single quotes and attributes in any order', () => {
    const parsed = parseGpx(readFixture('./fixtures/prefixed.gpx'));
    expect(parsed.creator).toBe('Prefixed Writer');
    expect(parsed.name).toBe('Prefixed metadata name'); // no track name, so the metadata name
    expect(parsed.points).toEqual([
      { lat: 45.8326, lon: 6.8652, ele: 4808.7, time: null },
      { lat: 45.8331, lon: 6.866, ele: 4790.2, time: null },
      { lat: 45.834, lon: 6.8671, ele: null, time: null }, // self-closing <trkpt/>
    ]);
  });

  it('copes with a byte-order mark and CRLF line endings', () => {
    const windows = '﻿' + readFixture('./fixtures/strava.gpx').replace(/\n/g, '\r\n');
    const parsed = parseGpx(windows);
    expect(parsed.name).toBe('Afternoon Trail Run');
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]?.ele).toBe(1219.4);
  });

  it('reads GPX 1.0, where name and time sit directly under <gpx>', () => {
    const parsed = parseGpx(`<?xml version="1.0"?>
<gpx version="1.0" creator="GPSBabel" xmlns="http://www.topografix.com/GPX/1/0">
  <name>Old file</name>
  <time>2009-04-12T09:00:00Z</time>
  <trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele><speed>1.2</speed></trkpt></trkseg></trk>
</gpx>`);
    expect(parsed.name).toBe('Old file');
    expect(parsed.time).toBe(iso('2009-04-12T09:00:00Z'));
    expect(parsed.points).toEqual([{ lat: 1, lon: 2, ele: 3, time: null }]);
  });
});

describe('parseGpx: names and text', () => {
  it('decodes CDATA, predefined entities and numeric character references', () => {
    const parsed = parseGpx(
      gpx(`<metadata><name>Ignored &amp; overridden</name></metadata>
<trk>
  <name><![CDATA[Morning Run <3]]> &amp; Caf&#233; &#xE9;t&#xe9; &lt;&gt;&quot;&apos; &#x1F3D4;</name>
  <type> <![CDATA[hiking]]> </type>
  <trkseg><trkpt lat="1" lon="1"/></trkseg>
</trk>`),
    );
    expect(parsed.name).toBe('Morning Run <3 & Café été <>"\' 🏔');
    expect(parsed.type).toBe('hiking');
  });

  it('keeps unknown entities verbatim instead of failing', () => {
    const parsed = parseGpx(
      gpx(
        '<trk><name>Ridge&nbsp;loop &bogus</name><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>',
      ),
    );
    expect(parsed.name).toBe('Ridge&nbsp;loop &bogus');
  });

  it('keeps entities named after Object.prototype members verbatim', () => {
    for (const raw of [
      '&toString;',
      '&valueOf;',
      '&__proto__;',
      '&constructor;',
      '&hasOwnProperty;',
    ]) {
      const parsed = parseGpx(
        `<gpx creator="${raw}"><metadata><name>m ${raw}</name></metadata><trk><name>${raw}</name><type>t${raw}</type><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`,
      );
      expect(parsed).toMatchObject({ name: raw, type: `t${raw}`, creator: raw });
    }
  });

  it('decodes entities in attributes', () => {
    const parsed = parseGpx(
      `<gpx creator="Tom &amp; Jerry&#39;s app"><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`,
    );
    expect(parsed.creator).toBe("Tom & Jerry's app");
  });

  it('ignores the author name inside metadata, comments and processing instructions', () => {
    const parsed = parseGpx(
      gpx(`<!-- <trk><name>commented out</name></trk> -->
<metadata><author><name>Sean</name></author><name>Weekend</name></metadata>
<?some-instruction data?>
<trk><trkseg><!-- a > b --><trkpt lat="1" lon="1"/></trkseg></trk>`),
    );
    expect(parsed.name).toBe('Weekend');
    expect(parsed.points).toHaveLength(1);
  });

  it('returns null name, type and time when the file has none', () => {
    const parsed = parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>');
    expect(parsed).toMatchObject({ name: null, type: null, creator: null, time: null });
  });
});

describe('parseGpx: points', () => {
  it('concatenates every segment of the first track, in order', () => {
    const parsed = parseGpx(
      gpx(`<trk><name>First</name>
  <trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
  <trkseg></trkseg>
  <trkseg><trkpt lat="3" lon="3"/></trkseg>
</trk>
<trk><name>Second</name><trkseg><trkpt lat="9" lon="9"/></trkseg></trk>`),
    );
    expect(parsed.name).toBe('First');
    expect(parsed.points.map((p) => p.lat)).toEqual([1, 2, 3]);
    expect(parsed.segments).toBe(2); // the empty segment contributes nothing
  });

  it('reads lat/lon when the point also has attributes named after Object.prototype members', () => {
    const parsed = parseGpx(
      gpx(`<trk><trkseg>
  <trkpt constructor="1" __proto__="x" lat="45.5" lon="-122.25"/>
  <trkpt toString="y" lat="45.6" valueOf="z" lon="-122.5" hasOwnProperty="w"><ele>3</ele></trkpt>
</trkseg></trk>`),
    );
    expect(parsed.points).toEqual([
      { lat: 45.5, lon: -122.25, ele: null, time: null },
      { lat: 45.6, lon: -122.5, ele: 3, time: null },
    ]);
  });

  it('returns null times when points have no <time>', () => {
    const parsed = parseGpx(
      gpx('<trk><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt></trkseg></trk>'),
    );
    expect(parsed.points).toEqual([{ lat: 1, lon: 1, ele: 10, time: null }]);
  });

  it('returns null elevations when points have no (or an unreadable) <ele>', () => {
    const parsed = parseGpx(
      gpx(`<trk><trkseg>
  <trkpt lat="1" lon="1"><time>2024-01-01T00:00:00Z</time></trkpt>
  <trkpt lat="1" lon="1"><ele></ele></trkpt>
  <trkpt lat="1" lon="1"><ele>n/a</ele></trkpt>
</trkseg></trk>`),
    );
    expect(parsed.points.map((p) => p.ele)).toEqual([null, null, null]);
    expect(parsed.points[0]?.time).toBe(iso('2024-01-01T00:00:00Z'));
  });

  it('falls back to the first route when there is no track', () => {
    const parsed = parseGpx(
      gpx(`<wpt lat="5" lon="5"><name>Hut</name></wpt>
<rte><name>Planned</name><rtept lat="1" lon="1"><ele>100</ele></rtept><rtept lat="2" lon="2"/></rte>
<rte><name>Other</name><rtept lat="8" lon="8"/></rte>`),
    );
    expect(parsed).toMatchObject({ name: 'Planned', source: 'rte', segments: 1 });
    expect(parsed.points).toEqual([
      { lat: 1, lon: 1, ele: 100, time: null },
      { lat: 2, lon: 2, ele: null, time: null },
    ]);
  });

  it('uses the first track that has valid points when earlier tracks have none', () => {
    const parsed = parseGpx(
      gpx(`<trk><name>Empty</name><trkseg/></trk>
<trk><name>Broken</name><type>a</type><trkseg><trkpt lat="x" lon="1"/></trkseg></trk>
<rte><name>Route</name><rtept lat="8" lon="8"/></rte>
<trk><name>Recorded</name><type>b</type><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>
<trk><name>Later</name><trkseg><trkpt lat="9" lon="9"/></trkseg></trk>`),
    );
    expect(parsed).toMatchObject({ name: 'Recorded', type: 'b', source: 'trk', segments: 1 });
    expect(parsed.points.map((p) => p.lat)).toEqual([1]);
  });

  it('falls back to the first route with points when no track has a valid point', () => {
    const parsed = parseGpx(
      gpx(`<trk><name>Broken</name><trkseg><trkpt lat="x" lon="1"/></trkseg></trk>
<rte><name>Empty</name></rte>
<rte><name>Planned</name><rtept lat="2" lon="2"/></rte>`),
    );
    expect(parsed).toMatchObject({ name: 'Planned', source: 'rte' });
    expect(parsed.points.map((p) => p.lat)).toEqual([2]);
  });

  it('prefers a track over a route that comes before it', () => {
    const parsed = parseGpx(
      gpx(
        '<rte><rtept lat="8" lon="8"/></rte><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>',
      ),
    );
    expect(parsed.source).toBe('trk');
    expect(parsed.points[0]?.lat).toBe(1);
  });

  it('accepts only plain decimals for lat and lon', () => {
    const parsed = parseGpx(
      gpx(`<trk><trkseg>
  <trkpt lat="+1.5" lon="-2"/><trkpt lat=".5" lon="3."/><trkpt lat="007" lon="0.000"/>
  <trkpt lat="0x1A" lon="1"/><trkpt lat="0b1" lon="1"/><trkpt lat="Infinity" lon="1"/>
  <trkpt lat="1e1" lon="1"/><trkpt lat="1" lon="1E1"/><trkpt lat="1.2.3" lon="1"/>
  <trkpt lat="-" lon="1"/><trkpt lat="." lon="1"/>
  <trkpt lat="4" lon="4"/><trkpt lat="5" lon="5"/><trkpt lat="6" lon="6"/><trkpt lat="7" lon="7"/>
  <trkpt lat="8" lon="8"/>
</trkseg></trk>`),
    );
    expect(parsed.points.map((p) => [p.lat, p.lon])).toEqual([
      [1.5, -2],
      [0.5, 3],
      [7, 0],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
    ]);
  });

  it('accepts a decimal elevation with an optional exponent, and nothing else', () => {
    const elevations = ['-12.5', '1.2E3', '5e-1', '0x10', 'Infinity', '1e', ' 7 '].map((ele) => {
      const text = gpx(
        `<trk><trkseg><trkpt lat="1" lon="1"><ele>${ele}</ele></trkpt></trkseg></trk>`,
      );
      return parseGpx(text).points[0]?.ele;
    });
    expect(elevations).toEqual([-12.5, 1200, 0.5, null, null, null, 7]);
  });

  it('skips points with missing, non-numeric or out-of-range coordinates', () => {
    const parsed = parseGpx(
      gpx(`<trk><trkseg>
  <trkpt lat="10" lon="10"/><trkpt lat="11" lon="11"/><trkpt lat="12" lon="12"/>
  <trkpt lat="91" lon="0"/><trkpt lat="0" lon="-180.5"/><trkpt lat="" lon="1"/>
  <trkpt lon="1"/><trkpt lat="abc" lon="1"/>
  <trkpt lat="-90" lon="180"/><trkpt lat=" 13 " lon="13"/>
</trkseg></trk>`),
    );
    expect(parsed.points.map((p) => [p.lat, p.lon])).toEqual([
      [10, 10],
      [11, 11],
      [12, 12],
      [-90, 180],
      [13, 13],
    ]);
  });
});

describe('parseGpx: repeated name, type, time and ele', () => {
  const trk = '<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>';
  const t1 = '2024-01-02T03:04:05Z';
  const t2 = '2025-06-07T08:09:10Z';

  // Regressions: a repeated top-level element was left unconsumed, so its closing tag ended the
  // <gpx> loop early and the track after it was never read (`no-points` on a valid file).
  it.each([
    ['two top-level names', `<name>a</name><name>b</name>`, { name: 'a', time: null }],
    ['two top-level times', `<time>${t1}</time><time>${t2}</time>`, { name: null, time: iso(t1) }],
    [
      'a metadata name, then a top-level name',
      `<metadata><name>m</name></metadata><name>root</name>`,
      { name: 'm', time: null },
    ],
    [
      'a metadata time, then a top-level time',
      `<metadata><time>${t1}</time></metadata><time>${t2}</time>`,
      { name: null, time: iso(t1) },
    ],
    ['a name, then an empty self-closed name', `<name>a</name><name/>`, { name: 'a', time: null }],
  ])('reads the track after %s', (_, before, expected) => {
    const parsed = parseGpx(`<gpx version="1.0">${before}${trk}</gpx>`);
    expect(parsed).toMatchObject(expected);
    expect(parsed.points).toEqual([{ lat: 1, lon: 2, ele: null, time: null }]);
  });

  it('keeps the first non-empty file name, in document order across metadata and top level', () => {
    const name = (body: string): string | null => parseGpx(`<gpx>${body}${trk}</gpx>`).name;
    expect(name('<name>root</name><metadata><name>m</name></metadata>')).toBe('root');
    expect(name('<metadata><name>m</name></metadata><name>root</name>')).toBe('m');
    expect(name('<metadata><name>m1</name><name>m2</name></metadata>')).toBe('m1');
    expect(name('<name/><name> </name><metadata><name>m</name></metadata>')).toBe('m');
    expect(name('<metadata><name></name></metadata><name>root</name>')).toBe('root');
  });

  it('keeps the first parseable file time, in document order across metadata and top level', () => {
    const time = (body: string): number | null => parseGpx(`<gpx>${body}${trk}</gpx>`).time;
    expect(time(`<time>${t1}</time><metadata><time>${t2}</time></metadata>`)).toBe(iso(t1));
    expect(time(`<metadata><time>${t1}</time></metadata><time>${t2}</time>`)).toBe(iso(t1));
    expect(time(`<metadata><time>soon</time></metadata><time>${t2}</time>`)).toBe(iso(t2));
    expect(time(`<time/><metadata><time>${t2}</time><time>${t1}</time></metadata>`)).toBe(iso(t2));
  });

  it('keeps the first non-empty track and route name and type', () => {
    const track = parseGpx(
      gpx(`<trk><name/><name>a</name><name>b</name><type>run</type><type>ride</type>
<trkseg><trkpt lat="1" lon="1"/></trkseg></trk>`),
    );
    expect(track).toMatchObject({ name: 'a', type: 'run' });
    const route = parseGpx(
      gpx(`<rte><name>r1</name><name>r2</name><type> </type><type>hike</type>
<rtept lat="1" lon="1"/></rte>`),
    );
    expect(route).toMatchObject({ name: 'r1', type: 'hike' });
  });

  it('keeps the first readable ele and time of a point', () => {
    const parsed = parseGpx(
      gpx(`<trk><trkseg><trkpt lat="1" lon="1">
  <ele>high</ele><ele>10</ele><ele>20</ele><time>later</time><time>${t1}</time><time>${t2}</time>
</trkpt></trkseg></trk>`),
    );
    expect(parsed.points).toEqual([{ lat: 1, lon: 1, ele: 10, time: iso(t1) }]);
  });
});

describe('parseGpx: every element is consumed', () => {
  const pt = '<trkpt lat="1" lon="2"/>';
  const valid = { lat: 1, lon: 2, ele: null, time: null };
  const t = '2024-01-02T03:04:05Z';

  /**
   * Each element (given twice, so a "first value wins" branch is taken too) placed before a valid
   * point at some depth: if any branch left the element unconsumed, its closing tag would close
   * the parent early and the point after it would be lost or misplaced.
   */
  function expectReadsOnAfter(elements: string[], build: (twice: string) => string): void {
    for (const element of elements) {
      const parsed = parseGpx(build(element + element));
      expect(parsed.points.at(-1), element).toEqual(valid);
    }
  }

  it('under <gpx>', () => {
    expectReadsOnAfter(
      [
        `<metadata><name>m</name><time>${t}</time></metadata>`,
        '<metadata/>',
        '<name>a</name>',
        '<name/>',
        '<name> </name>',
        `<time>${t}</time>`,
        '<time>never</time>',
        '<time/>',
        '<desc>d</desc>',
        '<wpt lat="1" lon="1"><name>w</name></wpt>',
        '<extensions><x><name>e</name><trk/></x></extensions>',
        '<rte><name>r</name><rtept lat="5" lon="5"/></rte>',
        '<trk><name>no points</name><trkseg/></trk>',
        '<unknown>text<name>n</name></unknown>',
      ],
      (twice) => `<gpx version="1.0">${twice}<trk><trkseg>${pt}</trkseg></trk></gpx>`,
    );
  });

  it('under <metadata>', () => {
    expectReadsOnAfter(
      [
        '<name>m</name>',
        '<name/>',
        `<time>${t}</time>`,
        '<time>x</time>',
        '<author><name>s</name></author>',
        '<link href="x"><text>t</text></link>',
        '<bounds minlat="0" minlon="0" maxlat="1" maxlon="1"/>',
        '<extensions><name>e</name></extensions>',
      ],
      (twice) => gpx(`<metadata>${twice}</metadata><trk><trkseg>${pt}</trkseg></trk>`),
    );
  });

  it('under <trk> and <rte>', () => {
    const children = [
      '<name>a</name>',
      '<name/>',
      '<type>run</type>',
      '<type/>',
      '<desc>d</desc>',
      '<number>1</number>',
      '<link href="x"><text>t</text></link>',
      '<extensions><name>e</name></extensions>',
    ];
    expectReadsOnAfter(children, (twice) => gpx(`<trk>${twice}<trkseg>${pt}</trkseg></trk>`));
    expectReadsOnAfter(children, (twice) => gpx(`<rte>${twice}<rtept lat="1" lon="2"/></rte>`));
  });

  it('under <trkseg>', () => {
    expectReadsOnAfter(
      ['<trkpt lat="3" lon="4"><ele>1</ele></trkpt>', '<extensions><trkpt/></extensions>'],
      (twice) => gpx(`<trk><trkseg>${twice}${pt}</trkseg></trk>`),
    );
  });

  it('under <trkpt> and <rtept>', () => {
    const children = [
      '<ele>1</ele>',
      '<ele>bad</ele>',
      '<ele/>',
      `<time>${t}</time>`,
      '<time>bad</time>',
      '<time/>',
      '<hdop>1</hdop>',
      '<extensions><ele>9</ele><time>x</time></extensions>',
    ];
    expectReadsOnAfter(children, (twice) =>
      gpx(`<trk><trkseg><trkpt lat="3" lon="4">${twice}</trkpt>${pt}</trkseg></trk>`),
    );
    expectReadsOnAfter(children, (twice) =>
      gpx(`<rte><rtept lat="3" lon="4">${twice}</rtept><rtept lat="1" lon="2"/></rte>`),
    );
  });
});

describe('parseGpx: errors', () => {
  it('throws not-gpx for HTML', () => {
    const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>x</title>';
    expect(errorCode(() => parseGpx(html))).toBe('not-gpx');
  });

  it('throws not-gpx for random text, empty input and other XML', () => {
    expect(errorCode(() => parseGpx('just some notes, 3 < 4 and that is all'))).toBe('not-gpx');
    expect(errorCode(() => parseGpx('hello world'))).toBe('not-gpx');
    expect(errorCode(() => parseGpx(''))).toBe('not-gpx');
    expect(errorCode(() => parseGpx('<?xml version="1.0"?><kml><Document/></kml>'))).toBe(
      'not-gpx',
    );
  });

  it('throws no-points for a waypoints-only file', () => {
    const waypoints = gpx('<wpt lat="1" lon="1"><name>A</name></wpt><wpt lat="2" lon="2"/>');
    expect(errorCode(() => parseGpx(waypoints))).toBe('no-points');
  });

  it('throws malformed when every point is invalid', () => {
    const allBad = gpx(
      '<trk><trkseg/></trk><trk><trkseg><trkpt lat="x" lon="1"/></trkseg></trk><rte/>',
    );
    expect(errorCode(() => parseGpx(allBad))).toBe('malformed');
  });

  it('throws no-points for an empty track or an empty root', () => {
    expect(errorCode(() => parseGpx(gpx('<trk><trkseg/></trk>')))).toBe('no-points');
    expect(errorCode(() => parseGpx('<gpx version="1.1"/>'))).toBe('no-points');
  });

  it('uses the UI copy for no-points', () => {
    expect(() => parseGpx(gpx(''))).toThrow(
      'This file has no track points. Vert needs a GPX track recorded by a watch or app.',
    );
  });

  it('throws malformed for a truncated file', () => {
    // Cut mid-point, mid-tag, mid-attribute and right after a closing tag.
    for (const cut of [300_000, sample.indexOf('lat=', 500) + 6, sample.indexOf('</trkseg>')]) {
      expect(errorCode(() => parseGpx(sample.slice(0, cut)))).toBe('malformed');
    }
    expect(errorCode(() => parseGpx(sample.slice(0, sample.indexOf('<trkpt', 400) + 3)))).toBe(
      'malformed',
    );
  });

  it('throws malformed for broken markup inside <gpx>', () => {
    const cases = [
      gpx('<trk><trkseg><trkpt lat="1" lon="1"></trkseg></trk>'), // mismatched close
      gpx('<trk><trkseg><trkpt lat=1 lon=1/></trkseg></trk>'), // unquoted attributes
      gpx('<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></extra>'), // stray close
      gpx('<trk><name><![CDATA[never closed</name></trk>'), // unterminated CDATA
      gpx('<trk><!-- never closed </trk>'), // unterminated comment
      gpx('<trk>< trkseg></trk>'), // garbage tag
    ];
    for (const text of cases) expect(errorCode(() => parseGpx(text))).toBe('malformed');
  });

  it('throws malformed when more than half the points are invalid', () => {
    const mostlyBad = gpx(
      '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="x" lon="1"/><trkpt lat="99" lon="1"/></trkseg></trk>',
    );
    expect(errorCode(() => parseGpx(mostlyBad))).toBe('malformed');
    const halfBad = gpx(
      '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="x" lon="1"/></trkseg></trk>',
    );
    expect(parseGpx(halfBad).points).toHaveLength(1);
  });

  it('throws too-large past maxPoints', () => {
    expect(errorCode(() => parseGpx(sample, { maxPoints: 1000 }))).toBe('too-large');
    expect(parseGpx(sample, { maxPoints: 5623 }).points).toHaveLength(5623);
  });
});

describe('parseIsoTime', () => {
  it('reads UTC, offsets and fractional seconds', () => {
    expect(parseIsoTime('2026-10-03T11:10:00Z')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-03T13:10:00+02:00')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-03T06:10:00-0500')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-04T01:10:00+14:00')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-02T21:10:00-14')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-03T16:55:00+05:45')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
    expect(parseIsoTime('2026-10-03T11:10:00.25Z')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0, 250));
    expect(parseIsoTime('2026-10-03T11:10:00.123456Z')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0, 123));
    expect(parseIsoTime(' 2026-10-03T11:10:00Z\n')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
  });

  it('reads a time without a zone as UTC, as the GPX schema says', () => {
    expect(parseIsoTime('2026-10-03T11:10:00')).toBe(Date.UTC(2026, 9, 3, 11, 10, 0));
  });

  it('returns null for missing or unparsable values', () => {
    for (const value of [
      null,
      '',
      'yesterday',
      '2026-10-03',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '0000-00-00T00:00:00Z',
      '2026-10-03T11:10:00+15:00', // offsets stop at ±14:00
      '2026-10-03T11:10:00-14:30',
      '2026-10-03T11:10:00+05:60', // minutes below 60
      '2026-10-03T11:10:00+0599',
      '2026-10-03T11:10:00+99',
    ]) {
      expect(parseIsoTime(value)).toBeNull();
    }
  });

  it('turns an unparsable point time into null without dropping the point', () => {
    const parsed = parseGpx(
      gpx('<trk><trkseg><trkpt lat="1" lon="1"><time>garbage</time></trkpt></trkseg></trk>'),
    );
    expect(parsed.points).toEqual([{ lat: 1, lon: 1, ele: null, time: null }]);
  });
});
