import type { GlobalProvider } from '@ladle/react';
import '../src/styles/tokens.css';
import '../src/styles/base.css';

// Ladle paints its own white canvas; show stories on the app's page colour instead.
export const Provider: GlobalProvider = ({ children }) => (
  <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>{children}</div>
);
