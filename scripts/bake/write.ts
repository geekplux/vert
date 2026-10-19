/**
 * Writing files so that a reader never sees a partial one: {@link writeFileAtomic} for one file
 * (a tile in the cache), {@link writeFilesTogether} for a set that must change together (a scene
 * and its sidecar: both new files, or both old ones, never one of each).
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The file system calls the writers make; tests replace some to inject failures. */
export interface FileOps {
  readonly writeFile: (path: string, data: Uint8Array | string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
  /** `'file'`, `'other'` (a directory…) or `null` when nothing is there. */
  readonly kind: (path: string) => 'file' | 'other' | null;
}

export const NODE_FILE_OPS: FileOps = {
  writeFile: (path, data) => {
    writeFileSync(path, data);
  },
  rename: (from, to) => {
    renameSync(from, to);
  },
  remove: (path) => {
    rmSync(path, { force: true });
  },
  kind: (path) => {
    try {
      return lstatSync(path).isFile() ? 'file' : 'other';
    } catch {
      return null;
    }
  },
};

let counter = 0;
const sibling = (path: string, tag: string) =>
  `${path}.${tag}-${String(process.pid)}-${String(counter++)}`;

/** Writes `data` to `path` atomically: a temporary file beside it, then a rename. */
export function writeFileAtomic(
  path: string,
  data: Uint8Array | string,
  ops: FileOps = NODE_FILE_OPS,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = sibling(path, 'tmp');
  try {
    ops.writeFile(temporary, data);
    ops.rename(temporary, path);
  } catch (error) {
    ops.remove(temporary);
    throw error;
  }
}

/**
 * The leftovers a {@link writeFilesTogether} leaves beside a target while it runs, by suffix:
 *
 * - `tmp`: the new file, not yet renamed into place;
 * - `old`: the previous file, moved aside;
 * - `none`: an empty marker saying the target did not exist before (so undoing removes it);
 * - `done`: an `old` or `none` after the swap was committed (to be deleted).
 */
type LeftoverKind = 'tmp' | 'old' | 'none' | 'done';

/** The leftovers beside `path`, newest first within a kind. */
function leftoversOf(path: string): { kind: LeftoverKind; path: string }[] {
  const dir = dirname(path);
  const name = basename(path);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // no directory yet: nothing left over
  }
  return entries
    .map((entry) => ({
      entry,
      match: /^\.(tmp|old|none|done)-\d+-\d+$/.exec(entry.slice(name.length)),
    }))
    .filter(({ entry, match }) => entry.startsWith(name) && match !== null)
    .map(({ entry, match }) => ({
      kind: (match?.[1] ?? 'tmp') as LeftoverKind,
      path: join(dir, entry),
      time: statSync(join(dir, entry)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time || (a.path < b.path ? 1 : -1))
    .map(({ kind, path: leftover }) => ({ kind, path: leftover }));
}

/**
 * Cleans up after a {@link writeFilesTogether} of `paths` (one set, such as a scene and its
 * sidecar) that was killed (SIGKILL, power loss) before it finished or could undo itself. Run it
 * before a bake writes those targets. The set always ends up whole, old or new, never mixed:
 *
 * - **Committed** (a `done` leftover beside any target): the new set is in place; the leftovers are
 *   deleted, every `old` and `none` of the set before any `done` (so a second crash during this
 *   cleanup still reads as committed).
 * - **Not committed** (an `old` or `none` leftover beside any target, and no `done`): the swap had
 *   started, so the whole set reverts. A target with an `old` gets it back (the newest, replacing
 *   whatever is there); a target with a `none` marker is removed (it did not exist before); a target
 *   with neither had not been touched yet and stays as it is.
 * - Otherwise only temporary files are left (killed before the swap began): they are deleted.
 */
export function recoverLeftovers(paths: readonly string[], ops: FileOps = NODE_FILE_OPS): void {
  const sets = paths.map((path) => ({ path, leftovers: leftoversOf(path) }));
  const any = (kind: LeftoverKind) => sets.some((s) => s.leftovers.some((l) => l.kind === kind));
  const committed = any('done');
  const revert = !committed && (any('old') || any('none'));
  if (committed) {
    // Every `old` and `none` of the pair goes before any `done`: a crash in the middle of this
    // cleanup must not leave an `old` without a `done`, which would read as a swap to undo.
    for (const { leftovers } of sets) {
      for (const l of leftovers) if (l.kind === 'old' || l.kind === 'none') ops.remove(l.path);
    }
  }
  for (const { path, leftovers } of sets) {
    let kept: string | null = null;
    if (revert) {
      const old = leftovers.find((l) => l.kind === 'old');
      if (old) {
        ops.rename(old.path, path);
        kept = old.path;
      } else if (leftovers.some((l) => l.kind === 'none')) {
        ops.remove(path);
      }
    }
    for (const leftover of leftovers) if (leftover.path !== kept) ops.remove(leftover.path);
  }
}

/** A target that cannot be replaced by a file (a directory, say). */
export class NotAFileError extends Error {
  override name = 'NotAFileError';
}

/**
 * Writes every file of `files` or none, and leaves the set whole (all old or all new) even if the
 * process dies on the way, once {@link recoverLeftovers} has run:
 *
 * 1. each new file is written to a temporary file beside its target;
 * 2. each target that does not exist yet gets an empty `none` marker;
 * 3. each existing target is moved aside (`old`), and the temporary file renamed into place;
 * 4. commit: every `old` and `none` is renamed to `done` (one `done` means the set is new);
 * 5. the `done` files are deleted.
 *
 * If a step fails in steps 1–3, everything done so far is undone (new files removed, old ones put
 * back, temporary files and markers deleted) and the error rethrown, so every target is as it was.
 * Directories are created as needed.
 *
 * @throws NotAFileError (before writing anything) when a target exists and is not a file.
 */
export function writeFilesTogether(
  files: readonly { readonly path: string; readonly data: Uint8Array | string }[],
  ops: FileOps = NODE_FILE_OPS,
): void {
  for (const { path } of files) {
    if (ops.kind(path) === 'other') throw new NotAFileError(`${basename(path)} is not a file`);
  }
  for (const { path } of files) mkdirSync(dirname(path), { recursive: true });

  const temporaries: string[] = [];
  /** The `old` or `none` leftover of each target, in order. */
  const asides: string[] = [];
  /** What has been done in step 3, to undo in reverse. */
  const done: ({ kind: 'moved'; from: string; to: string } | { kind: 'placed'; path: string })[] =
    [];
  try {
    for (const { path, data } of files) {
      const temporary = sibling(path, 'tmp');
      temporaries.push(temporary);
      ops.writeFile(temporary, data);
    }
    for (const { path } of files) {
      if (ops.kind(path) === null) {
        const marker = sibling(path, 'none');
        asides.push(marker);
        ops.writeFile(marker, '');
      }
    }
    files.forEach(({ path }, i) => {
      if (ops.kind(path) === 'file') {
        const backup = sibling(path, 'old');
        asides.push(backup);
        ops.rename(path, backup);
        done.push({ kind: 'moved', from: path, to: backup });
      }
      ops.rename(temporaries[i] ?? '', path);
      done.push({ kind: 'placed', path });
    });
  } catch (error) {
    for (const step of done.reverse()) {
      try {
        if (step.kind === 'placed') ops.remove(step.path);
        else ops.rename(step.to, step.from);
      } catch {
        // Best effort: keep undoing the rest.
      }
    }
    for (const leftover of [...temporaries, ...asides]) ops.remove(leftover);
    throw error;
  }
  const committed = asides.map((aside) => {
    const target = aside.replace(/\.(?:old|none)(-\d+-\d+)$/, '.done$1');
    ops.rename(aside, target);
    return target;
  });
  for (const leftover of committed) ops.remove(leftover);
}
