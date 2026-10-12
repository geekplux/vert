import type { ReactNode } from 'react';
import styles from './StatTile.module.css';

export interface StatGridProps {
  /** `StatTile`s. */
  children: ReactNode;
  className?: string;
}

/** The aside's 2-column stat grid: a `<dl>` whose items are `StatTile`s. */
export function StatGrid({ children, className }: StatGridProps) {
  return <dl className={[styles.grid, className].filter(Boolean).join(' ')}>{children}</dl>;
}
