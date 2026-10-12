import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from './axe';

describe('expectNoAxeViolations', () => {
  it('passes accessible markup', async () => {
    const { container } = render(<button type="button">Make a poster</button>);
    await expectNoAxeViolations(container);
  });

  it('fails an unlabelled control', async () => {
    const { container } = render(<button type="button" />);
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/button-name/);
  });
});
