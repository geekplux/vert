import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('stubs canvas getContext to return null (jsdom has no canvas)', () => {
    const canvas = document.createElement('canvas');
    expect(canvas.getContext('2d')).toBeNull();
    expect(canvas.getContext('webgl2')).toBeNull();
  });
});
