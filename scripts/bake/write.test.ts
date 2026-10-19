// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  NODE_FILE_OPS,
  NotAFileError,
  recoverLeftovers,
  writeFilesTogether,
  type FileOps,
} from './write';

const root = mkdtempSync(join(tmpdir(), 'vert-bake-write-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
let n = 0;
const freshDir = () => {
  const dir = join(root, String(n++));
  mkdirSync(dir);
  return dir;
};

const pair = (dir: string, scene: string, sidecar: string) => [
  { path: join(dir, 'run.scene'), data: scene },
  { path: join(dir, 'run.scene.json'), data: sidecar },
];
const contents = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
  );

/** File ops whose `nth` call of `op` throws. */
function failing(op: 'rename' | 'writeFile', nth: number, onlyTemporaries = true): FileOps {
  let calls = 0;
  const shouldFail = (path: string) =>
    (!onlyTemporaries || path.includes('.tmp-')) && ++calls === nth;
  return {
    ...NODE_FILE_OPS,
    rename: (from, to) => {
      if (op === 'rename' && shouldFail(from)) throw new Error('EIO: rename failed');
      NODE_FILE_OPS.rename(from, to);
    },
    writeFile: (path, data) => {
      if (op === 'writeFile' && shouldFail(path)) throw new Error('ENOSPC: no space');
      NODE_FILE_OPS.writeFile(path, data);
    },
  };
}

describe('writeFilesTogether', () => {
  it('writes both files, then replaces both, leaving nothing else', () => {
    const dir = freshDir();
    writeFilesTogether(pair(dir, 'scene 1', 'sidecar 1'));
    expect(contents(dir)).toEqual({ 'run.scene': 'scene 1', 'run.scene.json': 'sidecar 1' });
    writeFilesTogether(pair(dir, 'scene 2', 'sidecar 2'));
    expect(contents(dir)).toEqual({ 'run.scene': 'scene 2', 'run.scene.json': 'sidecar 2' });
  });

  it('the second rename fails, nothing there before: neither file is left', () => {
    const dir = freshDir();
    expect(() => {
      writeFilesTogether(pair(dir, 'new', 'new'), failing('rename', 2));
    }).toThrow(/rename failed/);
    expect(contents(dir)).toEqual({});
  });

  it('the second rename fails over a previous scene: both old files are back', () => {
    const dir = freshDir();
    writeFilesTogether(pair(dir, 'old scene', 'old sidecar'));
    expect(() => {
      writeFilesTogether(pair(dir, 'new scene', 'new sidecar'), failing('rename', 2));
    }).toThrow(/rename failed/);
    expect(contents(dir)).toEqual({ 'run.scene': 'old scene', 'run.scene.json': 'old sidecar' });
  });

  it('a temporary file cannot be written: nothing changes', () => {
    const dir = freshDir();
    writeFilesTogether(pair(dir, 'old scene', 'old sidecar'));
    expect(() => {
      writeFilesTogether(pair(dir, 'new scene', 'new sidecar'), failing('writeFile', 2));
    }).toThrow(/ENOSPC/);
    expect(contents(dir)).toEqual({ 'run.scene': 'old scene', 'run.scene.json': 'old sidecar' });
  });

  it('a target that is a directory: refused before anything is written', () => {
    const dir = freshDir();
    mkdirSync(join(dir, 'run.scene.json'));
    writeFileSync(join(dir, 'run.scene.json', 'keep'), 'x');
    expect(() => {
      writeFilesTogether(pair(dir, 'new', 'new'));
    }).toThrow(NotAFileError);
    expect(readdirSync(dir)).toEqual(['run.scene.json']);
  });
});

describe('recoverLeftovers (after a bake killed mid-write)', () => {
  const targets = (dir: string) => [join(dir, 'run.scene'), join(dir, 'run.scene.json')];

  /**
   * File ops that "die" after `steps` changes to the disk: every later write, rename or remove does
   * nothing (and nothing is undone), which is what SIGKILL at that point leaves behind.
   */
  function killedAfter(steps: number): FileOps {
    let count = 0;
    const alive = () => count++ < steps;
    return {
      ...NODE_FILE_OPS,
      writeFile: (path, data) => {
        if (alive()) NODE_FILE_OPS.writeFile(path, data);
      },
      rename: (from, to) => {
        if (alive()) NODE_FILE_OPS.rename(from, to);
      },
      remove: (path) => {
        if (alive()) NODE_FILE_OPS.remove(path);
      },
    };
  }

  /** Changes to the disk a full writeFilesTogether of a pair makes, over an old pair or none. */
  const STEPS = { overOld: 2 + 4 + 2 + 2, fresh: 2 + 2 + 2 + 2 + 2 };
  const OLD = { 'run.scene': 'old scene', 'run.scene.json': 'old sidecar' };
  const NEW = { 'run.scene': 'new scene', 'run.scene.json': 'new sidecar' };

  // The four kill points named in review, over an old pair: steps 2, 3, 4 and 5 are
  // "temps written", "old scene moved aside", "new scene renamed in", "old sidecar moved aside".
  it.each([
    [2, 'after the temporary files are written'],
    [3, 'after the old scene is moved aside'],
    [4, 'after the new scene is renamed in'],
    [5, 'after the old sidecar is moved aside'],
  ])('killed %i steps in (%s): the old pair comes back', (steps) => {
    const dir = freshDir();
    writeFilesTogether(pair(dir, OLD['run.scene'], OLD['run.scene.json']));
    writeFilesTogether(pair(dir, NEW['run.scene'], NEW['run.scene.json']), killedAfter(steps));
    recoverLeftovers(targets(dir));
    expect(contents(dir)).toEqual(OLD);
  });

  it('at every kill point, over an old pair: the old pair until the commit, the new one after', () => {
    for (let steps = 0; steps <= STEPS.overOld; steps++) {
      const dir = freshDir();
      writeFilesTogether(pair(dir, OLD['run.scene'], OLD['run.scene.json']));
      writeFilesTogether(pair(dir, NEW['run.scene'], NEW['run.scene.json']), killedAfter(steps));
      recoverLeftovers(targets(dir));
      // 2 temps + 4 renames (old aside, new in, ×2) = 6 steps before the commit's first rename.
      expect(contents(dir), `killed after ${String(steps)} steps`).toEqual(steps <= 6 ? OLD : NEW);
    }
  });

  it('at every kill point, with nothing there before: nothing until the commit, the new pair after', () => {
    for (let steps = 0; steps <= STEPS.fresh; steps++) {
      const dir = freshDir();
      writeFilesTogether(pair(dir, NEW['run.scene'], NEW['run.scene.json']), killedAfter(steps));
      recoverLeftovers(targets(dir));
      // 2 temps + 2 markers + 2 renames = 6 steps before the commit's first rename.
      expect(contents(dir), `killed after ${String(steps)} steps`).toEqual(steps <= 6 ? {} : NEW);
    }
  });

  it('a crash mid-commit, then another mid-recovery: still the new pair', () => {
    for (let steps = 0; steps <= 3; steps++) {
      const dir = freshDir();
      writeFilesTogether(pair(dir, OLD['run.scene'], OLD['run.scene.json']));
      // Killed after the commit's first rename: new pair, scene .done, sidecar still .old.
      writeFilesTogether(pair(dir, NEW['run.scene'], NEW['run.scene.json']), killedAfter(7));
      expect(
        readdirSync(dir).filter((f) => f.includes('.done-') || f.includes('.old-')),
      ).toHaveLength(2);
      recoverLeftovers(targets(dir), killedAfter(steps)); // the recovery dies too
      recoverLeftovers(targets(dir));
      expect(contents(dir), `recovery killed after ${String(steps)} steps`).toEqual(NEW);
    }
  });

  it('several old copies: the newest is restored, the rest deleted', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'run.scene.old-1-0'), 'oldest');
    writeFileSync(join(dir, 'run.scene.old-2-0'), 'newest');
    utimesSync(join(dir, 'run.scene.old-1-0'), 1_000, 1_000);
    utimesSync(join(dir, 'run.scene.old-2-0'), 2_000, 2_000);
    recoverLeftovers(targets(dir));
    expect(contents(dir)).toEqual({ 'run.scene': 'newest' });
  });

  it('leaves other files alone, and a directory that does not exist yet', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'other.scene.old-1-0'), 'not ours');
    writeFileSync(join(dir, 'run.scene.older'), 'not a leftover name');
    writeFileSync(join(dir, 'run.scene'), 'current');
    recoverLeftovers(targets(dir));
    recoverLeftovers(targets(join(dir, 'missing')));
    expect(contents(dir)).toEqual({
      'other.scene.old-1-0': 'not ours',
      'run.scene': 'current',
      'run.scene.older': 'not a leftover name',
    });
  });
});
