export interface TableDef { columns: Record<string, string>; indexes?: string[] }

export const TABLES: Record<string, TableDef> = {
  _meta: { columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT NOT NULL' } },
  settings: { columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT NOT NULL', updatedAt: 'TEXT NOT NULL' } },
  providerConnections: {
    columns: {
      id: 'TEXT PRIMARY KEY',
      provider: 'TEXT NOT NULL',
      authType: 'TEXT NOT NULL',
      priority: 'INTEGER NOT NULL',
      isActive: 'INTEGER DEFAULT 1',
      data: 'TEXT NOT NULL',           // JSON: apiKey?, quota, cooldown, proxyOverride?, lastError?
      createdAt: 'TEXT NOT NULL',
      updatedAt: 'TEXT NOT NULL',
    },
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)',
      'CREATE INDEX IF NOT EXISTS idx_pc_active ON providerConnections(provider, isActive)',
      'CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)',
    ],
  },
  combos: {
    columns: { id: 'TEXT PRIMARY KEY', name: 'TEXT NOT NULL', mode: 'TEXT NOT NULL', data: 'TEXT NOT NULL', createdAt: 'TEXT NOT NULL', updatedAt: 'TEXT NOT NULL' },
    indexes: ['CREATE INDEX IF NOT EXISTS idx_combos_name ON combos(name)'],
  },
  usageHistory: {
    columns: { id: 'TEXT PRIMARY KEY', ts: 'TEXT NOT NULL', query: 'TEXT NOT NULL', comboId: 'TEXT NOT NULL', data: 'TEXT NOT NULL' },
    indexes: ['CREATE INDEX IF NOT EXISTS idx_usage_ts ON usageHistory(ts)'],
  },
  requestDetails: {
    columns: { id: 'TEXT PRIMARY KEY', ts: 'TEXT NOT NULL', usageId: 'TEXT NOT NULL', source: 'TEXT NOT NULL', data: 'TEXT NOT NULL' },
    indexes: ['CREATE INDEX IF NOT EXISTS idx_details_usage ON requestDetails(usageId)'],
  },
  kv: { columns: { key: 'TEXT PRIMARY KEY', value: 'TEXT NOT NULL' } },
};

export function buildCreateTableSql(name: string, def: TableDef): string {
  const cols = Object.entries(def.columns).map(([n, t]) => `${n} ${t}`).join(', ');
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols})`;
}

export const SCHEMA_VERSION = 1;