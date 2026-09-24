import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAdapterForPath } from '../driver.js';
import { runMigrationOnce } from '../migrate.js';
import { listByProvider, getActiveByPriority, upsert, updateData, setIsActive } from './connectionsRepo.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('connectionsRepo', () => {
  let adapter: any; let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'wsr-'));
    adapter = await initAdapterForPath(join(dir, 'data.sqlite'));
    await runMigrationOnce(adapter);
  });
  afterEach(() => { adapter?.close?.(); rmSync(dir!, { recursive: true, force: true }); });

  const now = () => new Date().toISOString();

  it('upserts + lists by provider + selects active by priority asc', () => {
    upsert(adapter, { id: 'a1', provider: 'tavily', authType: 'apikey', priority: 1, isActive: true, data: { apiKey: 'k1' }, createdAt: now(), updatedAt: now() });
    upsert(adapter, { id: 'a2', provider: 'tavily', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'k2' }, createdAt: now(), updatedAt: now() });
    upsert(adapter, { id: 'a3', provider: 'tavily', authType: 'apikey', priority: 2, isActive: false, data: { apiKey: 'k3' }, createdAt: now(), updatedAt: now() });

    expect(listByProvider(adapter, 'tavily').length).toBe(3);
    const active = getActiveByPriority(adapter, 'tavily');
    expect(active.length).toBe(2);
    expect(active[0].id).toBe('a2'); // priority 0 first
    expect(active[0].data.apiKey).toBe('k2');
  });

  it('updateData merges into the JSON data blob', () => {
    upsert(adapter, { id: 'a1', provider: 'brave', authType: 'apikey', priority: 0, isActive: true, data: { apiKey: 'k1' }, createdAt: now(), updatedAt: now() });
    updateData(adapter, 'a1', { cooldown: { until: 123, level: 2 } });
    const rows = listByProvider(adapter, 'brave');
    expect((rows[0].data as any).apiKey).toBe('k1');
    expect((rows[0].data as any).cooldown.level).toBe(2);
  });

  it('setIsActive disables an account', () => {
    upsert(adapter, { id: 'a1', provider: 'brave', authType: 'apikey', priority: 0, isActive: true, data: {}, createdAt: now(), updatedAt: now() });
    setIsActive(adapter, 'a1', false);
    expect(getActiveByPriority(adapter, 'brave').length).toBe(0);
  });
});
