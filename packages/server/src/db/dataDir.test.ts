import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveDataDir, ensureDataDir } from './dataDir.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origEnv = process.env.DATA_DIR;

describe('dataDir', () => {
  beforeEach(() => { delete process.env.DATA_DIR; });
  afterEach(() => { if (origEnv !== undefined) process.env.DATA_DIR = origEnv; });

  it('uses DATA_DIR env when set', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wsr-'));
    process.env.DATA_DIR = tmp;
    expect(resolveDataDir()).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ensureDataDir creates the db subdir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wsr-'));
    process.env.DATA_DIR = tmp;
    const dir = ensureDataDir();
    expect(dir).toBe(join(tmp, 'db'));
    expect(existsSync(dir)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });
});
