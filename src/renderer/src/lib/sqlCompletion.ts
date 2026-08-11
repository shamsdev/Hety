import type { Completion } from '@codemirror/autocomplete'
import {
  MSSQL,
  MariaSQL,
  MySQL,
  PostgreSQL,
  type SQLDialect,
  type SQLNamespace
} from '@codemirror/lang-sql'
import type { DbSchema, SchemaTable } from '@shared/types'
import type { DatabaseKind } from '@shared/databases'

/** CodeMirror dialect matching a connection kind (quoting, keywords, comments). */
export function sqlDialectFor(kind?: DatabaseKind | string): SQLDialect {
  switch (kind) {
    case 'mysql':
    case 'clickhouse':
      return MySQL
    case 'mariadb':
      return MariaSQL
    case 'sqlserver':
      return MSSQL
    default:
      return PostgreSQL
  }
}

function columnCompletions(t: SchemaTable): Completion[] {
  return t.columns.map((c) => ({
    label: c.name,
    type: 'property',
    detail: c.pk ? `${c.type} · PK` : c.type,
    // primary keys float to the top of the column list
    boost: c.pk ? 1 : 0
  }))
}

function tableEntry(t: SchemaTable, view: boolean): SQLNamespace {
  return {
    self: { label: t.name, type: 'type', detail: view ? 'view' : 'table' },
    children: columnCompletions(t)
  }
}

/**
 * Turn an introspected schema into the nested namespace CodeMirror completes
 * against: `schema` → `table` → `column`, so `public.users.` and `u.` (via a
 * `FROM users u` alias) both resolve to real column names.
 */
export function buildSqlNamespace(schema?: DbSchema): SQLNamespace {
  const ns: Record<string, SQLNamespace> = {}
  if (!schema) return ns
  for (const s of schema.schemas) {
    const tables: Record<string, SQLNamespace> = {}
    for (const t of s.tables) tables[t.name] = tableEntry(t, false)
    for (const t of s.views) tables[t.name] = tableEntry(t, true)
    ns[s.name] = { self: { label: s.name, type: 'namespace' }, children: tables }
  }
  return ns
}

/**
 * The schema whose tables complete without a prefix. Prefers the only schema
 * there is, then the dialect's conventional default, then the database name.
 */
export function defaultSchemaFor(
  kind: DatabaseKind | string | undefined,
  dbName: string | undefined,
  schema?: DbSchema
): string | undefined {
  const names = schema?.schemas.map((s) => s.name) ?? []
  if (!names.length) return undefined
  if (names.length === 1) return names[0]
  const preferred =
    kind === 'sqlserver' ? ['dbo'] : kind === 'postgresql' ? ['public'] : [dbName ?? '']
  const hit = preferred.find((p) => p && names.includes(p))
  return hit ?? (dbName && names.includes(dbName) ? dbName : undefined)
}
