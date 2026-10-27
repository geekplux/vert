import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe on a rendered component and fails with a readable list of violations.
 * Contrast is not checked here: jsdom has no layout or computed colours. The e2e axe checks measure
 * contrast in a real browser.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const messages = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.html}`).join('\n')}`,
  );
  expect(messages, messages.join('\n\n')).toEqual([]);
}
