import { afterEach, describe, expect, it } from 'vitest';
import { ANALYTICS_HOST, MEASUREMENT_ID, startAnalytics } from './analytics';

const gtagScripts = () =>
  [...document.head.querySelectorAll('script')].filter((s) => s.src.includes('googletagmanager'));

afterEach(() => {
  for (const script of gtagScripts()) script.remove();
  delete window.dataLayer;
});

describe('startAnalytics', () => {
  it('does nothing off the live site', () => {
    for (const hostname of [
      'localhost',
      'vert.geekplux.org',
      'google-analytics-vert.workers.dev',
    ]) {
      expect(startAnalytics({ hostname, origin: `https://${hostname}`, pathname: '/' })).toBe(
        false,
      );
    }
    expect(gtagScripts()).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
  });

  it('on the live site, loads gtag.js and names the page without its query string', () => {
    const started = startAnalytics({
      hostname: ANALYTICS_HOST,
      origin: `https://${ANALYTICS_HOST}`,
      pathname: '/',
    });

    expect(started).toBe(true);
    expect(gtagScripts().map((s) => s.src)).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`,
    ]);
    const config = window.dataLayer
      ?.map((entry): unknown[] => [...(entry as IArguments)])
      .find((args) => args[0] === 'config');
    expect(config).toEqual([
      'config',
      MEASUREMENT_ID,
      {
        page_location: `https://${ANALYTICS_HOST}/`,
        page_title: 'Vert · Drop a GPX. Get a poster.',
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ]);
  });
});
