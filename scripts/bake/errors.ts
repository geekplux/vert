/**
 * Errors `pnpm bake` prints. A {@link BakeError}'s message is written for people and safe to print
 * as it is: it never holds a coordinate, a bound, a tile x/y or a tile URL. Any other error is a
 * bug; {@link printableMessage} scrubs its message before it reaches the terminal.
 */

/** A bake that cannot go on: bad input, a tile problem, a privacy finding. Exit code 1. */
export class BakeError extends Error {
  override name = 'BakeError';
}

/** A command line that cannot be understood. Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/**
 * The message of `error`, safe to print. A {@link BakeError} or {@link UsageError} is printed as
 * it is. Anything else is a bug whose message nobody vetted, so it is scrubbed: every decimal
 * with three or more fraction digits (a coordinate is one) and every `a/b/c` run of integers (a
 * tile z/x/y) becomes "…", and every URL "<url>".
 */
export function printableMessage(error: unknown): string {
  if (error instanceof BakeError || error instanceof UsageError) return error.message;
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : `Unexpected error: ${String(error)}`;
  return `${scrub(raw)} (a bug in the bake)`;
}

/** `text` without decimals of three or more fraction digits, integer triples or URLs. */
export function scrub(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\d+\/\d+\/\d+/g, '…')
    .replace(/-?\d*\.\d{3,}/g, '…');
}
