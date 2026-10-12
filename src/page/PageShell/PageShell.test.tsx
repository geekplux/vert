import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { PageShell } from './PageShell';
import { UploadLayout } from './UploadLayout';

describe('PageShell', () => {
  it('renders a named aside and one main with their content', () => {
    render(
      <PageShell asideLabel="Run details" aside={<p>Stats</p>}>
        <p>Terrain</p>
      </PageShell>,
    );
    const aside = screen.getByRole('complementary', { name: 'Run details' });
    expect(within(aside).getByText('Stats')).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(screen.getByRole('main')).getByText('Terrain')).toBeDefined();
  });

  it('puts the aside before main in the DOM, so it comes first in reading and Tab order', () => {
    render(
      <PageShell asideLabel="Poster settings" asideWidth="poster" aside={<p>Settings</p>}>
        <p>Preview</p>
      </PageShell>,
    );
    const aside = screen.getByRole('complementary');
    const main = screen.getByRole('main');
    expect(aside.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <PageShell asideLabel="Run details" aside={<h2>Run</h2>}>
        <h2>Terrain</h2>
      </PageShell>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('UploadLayout', () => {
  it('renders one main with the left column before the right', () => {
    render(<UploadLayout left={<h1>Your run, as terrain.</h1>} right={<p>Sample preview</p>} />);
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const heading = within(main).getByRole('heading', { level: 1 });
    const preview = within(main).getByText('Sample preview');
    expect(
      heading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <UploadLayout left={<h1>Your run, as terrain.</h1>} right={<p>Sample preview</p>} />,
    );
    await expectNoAxeViolations(container);
  });
});
