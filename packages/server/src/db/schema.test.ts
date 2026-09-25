import { describe, it, expect } from 'vitest';
import { TABLES, buildCreateTableSql } from './schema.js';

describe('schema', () => {
  it('providerConnections has fixed columns + a data JSON column', () => {
    expect(Object.keys(TABLES.providerConnections.columns)).toContain('data');
    expect(TABLES.providerConnections.columns.data).toContain('TEXT');
  });
  it('buildCreateTableSql emits CREATE TABLE IF NOT EXISTS with all columns', () => {
    const sql = buildCreateTableSql('kv', TABLES.kv);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS kv');
    expect(sql).toContain('key TEXT PRIMARY KEY');
    expect(sql).toContain('value TEXT');
  });
});
