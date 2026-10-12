import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { StatGrid } from './StatGrid';
import { StatTile } from './StatTile';

// Test-only formatters; the app's shared formatters arrive in src/lib in a later phase.
const oneDecimal = (value: number) => value.toFixed(1);
const signedGrouped = (value: number) => `+${value.toLocaleString('en-US')}`;
const hms = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

function renderFourStats() {
  return render(
    <StatGrid>
      <StatTile label="Distance" value={21.4} unit="km" format={oneDecimal} />
      <StatTile label="Vert" value={1070} unit="m" emphasis format={signedGrouped} />
      <StatTile label="Moving time" value={11560} format={hms} />
      <StatTile label="High point" value={820} unit="m" />
    </StatGrid>,
  );
}

/** The `<dd>` that follows the `<dt>` with this label. */
function definitionFor(label: string): HTMLElement {
  const terms = screen.getAllByRole('term');
  const definitions = screen.getAllByRole('definition');
  const index = terms.findIndex((term) => term.textContent === label);
  const definition = definitions[index];
  if (index < 0 || !definition) throw new Error(`No stat labelled ${label}`);
  return definition;
}

describe('StatTile', () => {
  it('renders label, value and unit as a term and its definition', () => {
    render(
      <StatGrid>
        <StatTile label="High point" value={820} unit="m" />
      </StatGrid>,
    );
    expect(screen.getByRole('term')).toHaveProperty('textContent', 'High point');
    const definition = screen.getByRole('definition');
    expect(definition.textContent).toBe('820 m');
    expect(definition.querySelector('span')?.textContent).toBe(' m');
  });

  it('groups digits en-US by default', () => {
    render(
      <StatGrid>
        <StatTile label="Vert" value={1070} unit="m" />
      </StatGrid>,
    );
    expect(screen.getByRole('definition').textContent).toBe('1,070 m');
  });

  it('uses a custom format', () => {
    renderFourStats();
    expect(definitionFor('Distance').textContent).toBe('21.4 km');
    expect(definitionFor('Vert').textContent).toBe('+1,070 m');
    expect(definitionFor('Moving time').textContent).toBe('3:12:40');
  });

  it('renders no unit element when unit is omitted', () => {
    renderFourStats();
    const definition = definitionFor('Moving time');
    expect(definition.textContent).toBe('3:12:40');
    expect(definition.querySelector('span')).toBeNull();
  });

  it('reflects emphasis on the tile', () => {
    renderFourStats();
    expect(definitionFor('Vert').parentElement?.dataset.emphasis).toBe('true');
    expect(definitionFor('Distance').parentElement?.dataset.emphasis).toBe('false');
    // The unit sits inside the emphasised tile, so the --route-text unit rule reaches it.
    const unit = definitionFor('Vert').querySelector('span');
    expect(unit?.textContent).toBe(' m');
    expect(unit?.closest('[data-emphasis="true"]')).toBe(definitionFor('Vert').parentElement);
  });

  it('pairs every term with a definition inside one description list', () => {
    const { container } = renderFourStats();
    const list = container.querySelector('dl');
    expect(list).not.toBeNull();
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Distance',
      'Vert',
      'Moving time',
      'High point',
    ]);
    expect(screen.getAllByRole('definition')).toHaveLength(4);
    for (const term of screen.getAllByRole('term')) {
      expect(list?.contains(term)).toBe(true);
    }
  });

  it('has no axe violations', async () => {
    const { container } = renderFourStats();
    await expectNoAxeViolations(container);
  });
});
