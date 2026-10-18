import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrolledUnder } from './useScrolledUnder';

/** jsdom has no IntersectionObserver: this one records its root and lets the test report entries. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;
  readonly callback: (entries: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void;
  readonly options: IntersectionObserverInit;
  constructor(
    callback: (entries: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  report(isIntersecting: boolean) {
    act(() => {
      this.callback([{ isIntersecting }]);
    });
  }
}

function Block() {
  const [sentinelRef, scrolledUnder] = useScrolledUnder();
  return (
    <aside aria-label="Poster settings">
      <p>{scrolledUnder ? 'under' : 'clear'}</p>
      <span ref={sentinelRef} data-testid="sentinel" />
    </aside>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIntersectionObserver.instances = [];
});

describe('useScrolledUnder', () => {
  it('watches the sentinel against its aside, and is true only while the sentinel is out of view', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { unmount } = render(<Block />);
    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('no observer');
    expect(observer.options.root).toBe(screen.getByRole('complementary'));
    expect(observer.targets).toEqual([screen.getByTestId('sentinel')]);
    expect(screen.getByText('clear')).toBeDefined();

    observer.report(false);
    expect(screen.getByText('under')).toBeDefined();
    observer.report(true);
    expect(screen.getByText('clear')).toBeDefined();

    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it('stays false where IntersectionObserver does not exist', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Block />);
    expect(screen.getByText('clear')).toBeDefined();
  });
});
