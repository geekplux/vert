import { describe, expect, it } from 'vitest';
import { acceptedExtensions, DEFAULT_MAX_BYTES, pickGpxFile } from './pickGpxFile';

function file(name: string, size = 10): File {
  const created = new File(['x'], name);
  Object.defineProperty(created, 'size', { value: size });
  return created;
}

describe('pickGpxFile', () => {
  it('returns null when there are no files', () => {
    expect(pickGpxFile([])).toBeNull();
  });

  it('takes the first .gpx, in any case, by default', () => {
    const wanted = file('B.GPX');
    expect(pickGpxFile([file('a.jpg'), wanted, file('c.gpx')])).toEqual({ file: wanted });
  });

  it('names the first file’s extension when none is accepted', () => {
    expect(pickGpxFile([file('run.fit'), file('notes')])).toEqual({
      error: "That's a .fit file. Vert reads .gpx files in v1.",
    });
    expect(pickGpxFile([file('README')])).toEqual({
      error: 'That file has no extension. Vert reads .gpx files in v1.',
    });
  });

  it('checks the size against the 20 MB default or the limit given', () => {
    expect(pickGpxFile([file('run.gpx', DEFAULT_MAX_BYTES)])).not.toHaveProperty('error');
    expect(pickGpxFile([file('run.gpx', DEFAULT_MAX_BYTES + 1)])).toEqual({
      error: 'That file is 20.1 MB. The limit is 20 MB.',
    });
    expect(pickGpxFile([file('run.gpx', 2 * 1024 * 1024)], '.gpx', 1024 * 1024)).toEqual({
      error: 'That file is 2 MB. The limit is 1 MB.',
    });
  });

  it('reads extensions from an accept string and ignores MIME types', () => {
    expect(acceptedExtensions('.gpx, .TCX, application/gpx+xml, .')).toEqual(['gpx', 'tcx']);
    expect(pickGpxFile([file('a.fit')], '.gpx,.tcx')).toEqual({
      error: "That's a .fit file. Vert reads .gpx or .tcx files in v1.",
    });
  });
});
