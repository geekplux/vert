// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_VERSION, VERT_LIB_VERSION } from './version';

describe('VERT_LIB_VERSION', () => {
  it('is package.json’s version marked +dev outside the library build', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      version: string;
    };
    expect(pkg.version).toBe('0.1.0');
    expect(DEV_VERSION).toBe(`${pkg.version}+dev`);
    expect(VERT_LIB_VERSION).toBe(DEV_VERSION);
  });
});
