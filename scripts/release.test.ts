// @vitest-environment node
/**
 * One version wherever a release names it: package.json and the top entry of the changelog
 * (docs/INTEGRATION.md §11). On a tag build (release.yml runs check.yml for the tag), the tag is
 * `v<version>` too.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const { version } = JSON.parse(read('package.json')) as { version: string };
const ref = process.env.GITHUB_REF ?? '';

describe('the release version', () => {
  it('is the changelog’s newest entry, with a date', () => {
    const changelog = read('docs/INTEGRATION.md').split('\n## 11. Changelog\n')[1] ?? '';
    expect(/^### (\S+) \(\d{4}-\d{2}-\d{2}\)$/m.exec(changelog)?.[1]).toBe(version);
  });

  it.runIf(ref.startsWith('refs/tags/'))('is the tag’s', () => {
    expect(ref).toBe(`refs/tags/v${version}`);
  });
});
