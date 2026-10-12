import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
});

// jsdom has no canvas: its getContext() returns null after printing "Not implemented". Return null
// quietly instead (what a browser does when it cannot make a context). Tests that need a context
// still override it with vi.spyOn(HTMLCanvasElement.prototype, 'getContext').
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}
