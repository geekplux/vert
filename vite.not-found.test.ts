// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_FOUND_TITLE, notFoundHtml, notFoundPage } from './vite.not-found.ts';

// The page the platform answers an unknown path with, at status 404 (wrangler.jsonc
// `not_found_handling: "404-page"`). It is the app shell, so a mistyped link still opens Vert,
// but it must not pass for the home page: its own title, noindex and no canonical.
const index = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const homeTitle = /<title>([^<]*)<\/title>/.exec(index)?.[1];

describe('404 page', () => {
  const page = notFoundHtml(index, NOT_FOUND_TITLE);

  it('has its own title, not the home page title', () => {
    expect(homeTitle).toBeTruthy();
    expect(page).toContain(`<title>${NOT_FOUND_TITLE}</title>`);
    expect(page).not.toContain(`<title>${homeTitle ?? ''}</title>`);
  });

  it('is noindex and names no canonical', () => {
    expect(page).toMatch(/<meta name="robots" content="noindex" \/>/);
    expect(index).toContain('rel="canonical"');
    expect(page).not.toContain('rel="canonical"');
  });

  it('keeps the rest of the shell', () => {
    expect(page).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(page.replace(/\s/g, '').length).toBeGreaterThan(index.replace(/\s/g, '').length - 120);
  });

  it('refuses a shell without a title', () => {
    expect(() => notFoundHtml('<html><head></head></html>', NOT_FOUND_TITLE)).toThrow('no <title>');
  });

  it('is emitted as 404.html next to index.html', () => {
    const emitted: { fileName: string; source: string }[] = [];
    const plugin = notFoundPage();
    const hook = plugin.generateBundle as { handler: (...args: unknown[]) => void };
    hook.handler.call(
      { emitFile: (file: { fileName: string; source: string }) => emitted.push(file) },
      {},
      { 'index.html': { type: 'asset', source: index } },
    );
    expect(emitted.map((file) => file.fileName)).toEqual(['404.html']);
    expect(emitted[0]?.source).toContain(`<title>${NOT_FOUND_TITLE}</title>`);
  });

  it('is what the platform serves for an unknown path', () => {
    const wrangler = readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8');
    expect(wrangler).toMatch(/"not_found_handling":\s*"404-page"/);
    expect(wrangler).not.toContain('single-page-application');
  });
});
