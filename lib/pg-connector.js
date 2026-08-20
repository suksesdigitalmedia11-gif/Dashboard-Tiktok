// Database Connector — Triple Mode (SQLite local / Turso edge / PostgreSQL)
// Priority: TURSO_URL > DATABASE_URL > local SQLite
let db = null, pool = null, turso = null, mode = 'sqlite';

// ── Mode Detection ──
if (process.env.TURSO_URL && process.env.TURSO_TOKEN) {
  mode = 'turso';
  try {
    const { createClient } = require('@libsql/client');
    turso = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN, intMode: 'string' });
    console.log('[db] Turso mode:', process.env.TURSO_URL.replace(/\/\/.*@/, '//***@'));
  } catch (e) { console.error('[db] Turso init failed:', e.message); mode = 'sqlite'; }
} else if (process.env.DATABASE_URL) {
  mode = 'postgres';
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 15000 });
    console.log('[db] PostgreSQL mode');
  } catch (e) { console.error('[db] PG init failed:', e.message); mode = 'sqlite'; }
}

if (mode === 'sqlite') {
  try {
    const path = require('path'), fs = require('fs'), Database = require('better-sqlite3');
    const DB_PATH = path.join(__dirname, '..', 'data', 'finance.db');
    if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH); db.pragma('journal_mode=WAL');
    console.log('[db] SQLite mode:', DB_PATH);
  } catch (e) { console.error('[db] SQLite fail:', e.message); }
}

// ── Helpers ──
function getDb() { return mode === 'postgres' ? null : db; }
function pgConfigured() { return true; }
function pgSetupMessage() { return ''; }

function normalizeSql(sql) {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/::date(\s*\+\s*interval\s*'\d+\s*day')?/gi, '')
    .replace(/::text/gi, '')
    .replace(/::text\[\]/gi, '');
}

// Convert Turso string-number rows to actual numbers (intMode='string' avoids BigInt crash)
function normalizeTursoRows(rows) {
  if (!rows || !rows.length) return [];
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
        out[k] = Number(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

// ── Core Query ──
async function pgQuery(sql, params = []) {
  // ── PostgreSQL ──
  if (mode === 'postgres' && pool) {
    try { const r = await pool.query(sql, params || []); return { rows: r.rows || [], changes: r.rowCount || 0 }; }
    catch (e) { console.error('[db] PG error:', e.message.substring(0, 80)); return { rows: [] }; }
  }

  // ── Turso ──
  if (mode === 'turso' && turso) {
    try {
      const s = normalizeSql(sql);
      const r = await turso.execute({ sql: s, args: params || [] });
      return { rows: normalizeTursoRows(r.rows || []), changes: r.rowsAffected || 0 };
    } catch (e) { console.error('[db] Turso error:', e.message.substring(0, 80)); return { rows: [] }; }
  }

  // ── SQLite (local) ──
  const d = getDb(); if (!d) return { rows: [] };
  try {
    const s = normalizeSql(sql);
    const u = s.trim().toUpperCase();
    if (u.startsWith('SELECT')) return { rows: d.prepare(s).all(...(params || [])) };
    const r = d.prepare(s).run(...(params || []));
    return { rows: [], changes: r.changes };
  } catch (e) { return { rows: [] }; }
}

// ── Supabase-style REST query parser ──
function whereOp(col, op, raw) {
  const v = raw.replace(/'/g, "''");
  if (op === 'eq') return `"${col}"='${v}'`;
  if (op === 'neq') return `"${col}"!='${v}'`;
  if (op === 'gte') return `"${col}">='${v}'`;
  if (op === 'lte') return `"${col}"<='${v}'`;
  if (op === 'lt') return `"${col}"<'${v}'`;
  if (op === 'gt') return `"${col}">'${v}'`;
  if (op === 'like') return `"${col}" LIKE '${v}'`;
  return `"${col}"='${v}'`;
}

function parseFetchQuery(queryStr, table) {
  let sql = `SELECT * FROM "${table}"`, where = [], order = '', limit = 100000;
  const parts = (queryStr || '').split('&').filter(Boolean);
  for (const p of parts) {
    const eq = p.indexOf('='); if (eq < 0) continue;
    const k = p.slice(0, eq), v = p.slice(eq + 1); if (!k) continue;
    if (k === 'select') { if (v !== '*') sql = sql.replace('*', v.split(',').map(c => `"${c.trim()}"`).join(',')); }
    else if (k === 'order') { const [c, d] = v.split('.'); order = `ORDER BY "${c}" ${d === 'desc' ? 'DESC' : 'ASC'}`; }
    else if (k === 'limit') { limit = parseInt(v) || 4000; }
    else if (k === 'and') {
      const inner = v.startsWith('(') ? v.slice(1, -1) : v;
      for (const ap of inner.split(',')) {
        const dot = ap.indexOf('.'); if (dot < 0) continue;
        const col = ap.slice(0, dot), val = ap.slice(dot + 1);
        const opDot = val.indexOf('.');
        if (opDot < 0) { where.push(`"${col}"='${val.replace(/'/g, "''")}'`); continue; }
        const op = val.slice(0, opDot), raw = decodeURIComponent(val.slice(opDot + 1));
        where.push(whereOp(col, op, raw));
      }
    } else {
      const dot = v.indexOf('.');
      if (dot < 0) { where.push(`"${k}"='${v.replace(/'/g, "''")}'`); }
      else { const op = v.slice(0, dot), raw = decodeURIComponent(v.slice(dot + 1)); where.push(whereOp(k, op, raw)); }
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  if (order) sql += ' ' + order;
  sql += ' LIMIT ' + limit;
  return sql;
}

async function fetchAll(table, queryStr = '') {
  const sql = parseFetchQuery(queryStr, table);
  console.log('[db] fetchAll SQL:', table, sql.substring(0, 250));

  if (mode === 'postgres' && pool) {
    try { const r = await pool.query(sql); return r.rows; }
    catch (e) { console.error('[db] fetchAll error:', e.message.substring(0, 80)); return []; }
  }
  if (mode === 'turso' && turso) {
    try { const s = normalizeSql(sql); const r = await turso.execute(s); return normalizeTursoRows(r.rows || []); }
    catch (e) { console.error('[db] fetchAll error:', e.message.substring(0, 80)); return []; }
  }
  const d = getDb(); if (!d) return [];
  try { return d.prepare(normalizeSql(sql)).all(); } catch (e) { return []; }
}

// ── Upsert ──
async function upsertRows(table, rows, conflictKey) {
  if (!rows || !rows.length) return [];
  const keys = Array.isArray(conflictKey) ? conflictKey : [conflictKey];
  const cols = Object.keys(rows[0]);
  const BATCH = 200;

  // Dedup within batch
  const dedup = (batch) => {
    const seen = new Set();
    return batch.filter(row => {
      const k = keys.map(k2 => row[k2] != null ? String(row[k2]) : '').join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // ── PostgreSQL ──
  if (mode === 'postgres' && pool) {
    const allCols = cols.map(c => `"${c}"`).join(',');
    const setCols = cols.filter(c => !keys.includes(c));
    const setClause = setCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(',');
    const conflictCols = keys.map(k => `"${k}"`).join(',');
    for (let i = 0; i < rows.length; i += BATCH) {
      let batch = dedup(rows.slice(i, i + BATCH));
      if (!batch.length) continue;
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        const ph = cols.map(() => '$' + (idx++));
        placeholders.push('(' + ph.join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      const sql = `INSERT INTO "${table}" (${allCols}) VALUES ${placeholders.join(',')} ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
      try { await pool.query(sql, values); } catch (e) { console.error('[db] upsert error:', e.message.substring(0, 80)); }
    }
    return rows;
  }

  // ── Turso & SQLite ──
  // Turso: use batch INSERT ... ON CONFLICT for speed (avoids N+1 HTTP calls)
  if (mode === 'turso' && turso) {
    for (let i = 0; i < rows.length; i += BATCH) {
      let batch = dedup(rows.slice(i, i + BATCH));
      if (!batch.length) continue;
      const allCols = cols.map(c => `"${c}"`).join(',');
      const setCols = cols.filter(c => !keys.includes(c));
      const setClause = setCols.map(c => `"${c}" = excluded."${c}"`).join(',');
      const conflictCols = keys.map(k => `"${k}"`).join(',');
      const values = [], phs = [];
      for (const row of batch) {
        phs.push('(' + cols.map(() => '?').join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      try {
        await turso.execute({
          sql: `INSERT INTO "${table}" (${allCols}) VALUES ${phs.join(',')} ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`,
          args: values
        });
      } catch (e) {
        // Fallback: simple INSERT (skip if duplicate)
        try {
          const insertSql = `INSERT OR IGNORE INTO "${table}" (${allCols}) VALUES ${phs.join(',')}`;
          await turso.execute({ sql: insertSql, args: values });
        } catch (e2) { /* truly fatal */ }
      }
    }
    return rows;
  }

  // SQLite local: row-by-row for reliability
  const saved = [];
  for (const row of rows) {
    const wc = keys.map(k => `"${k}"=?`).join(' AND ');
    const kv = keys.map(k => row[k]);
    try {
      const ex = db.prepare(`SELECT 1 FROM "${table}" WHERE ${wc} LIMIT 1`).get(...kv);
      if (ex) {
        const setCols = cols.filter(c => !keys.includes(c));
        const sets = setCols.map(c => `"${c}"=?`).join(',');
        const setVals = [...setCols.map(c => row[c]), ...kv];
        db.prepare(`UPDATE "${table}" SET ${sets} WHERE ${wc}`).run(...setVals);
      } else {
        const allCols = cols.map(c => `"${c}"`).join(',');
        const phs = cols.map(() => '?').join(',');
        const vals = cols.map(c => row[c]);
        db.prepare(`INSERT INTO "${table}" (${allCols}) VALUES (${phs})`).run(...vals);
      }
      saved.push(row);
    } catch (e) { /* skip on conflict */ }
  }
  return saved;
}

// ── Insert ──
async function insertRows(table, rows) {
  if (!rows || !rows.length) return [];
  const cols = Object.keys(rows[0]);
  const BATCH = 200;

  if (mode === 'postgres' && pool) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        const ph = cols.map(() => '$' + (idx++));
        placeholders.push('(' + ph.join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      try { await pool.query(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES ${placeholders.join(',')}`, values); } catch (e) { }
    }
    return rows;
  }

  // Turso: batch INSERT for speed
  if (mode === 'turso' && turso) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const allCols = cols.map(c => `"${c}"`).join(',');
      const values = [], phs = [];
      for (const row of batch) {
        phs.push('(' + cols.map(() => '?').join(',') + ')');
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      try {
        await turso.execute({ sql: `INSERT INTO "${table}" (${allCols}) VALUES ${phs.join(',')}`, args: values });
      } catch (e) { /* skip batch errors */ }
    }
    return rows;
  }

  // SQLite local & fallback: row-by-row
  for (const row of rows) {
    const cList = cols.map(c => `"${c}"`).join(',');
    const phs = cols.map(() => '?').join(',');
    const vals = cols.map(c => row[c]);
    try {
      db.prepare(`INSERT INTO "${table}" (${cList}) VALUES (${phs})`).run(...vals);
    } catch (e) { /* skip dup */ }
  }
  return rows;
}

// ── Ad Spend Upsert (with ON CONFLICT DO NOTHING) ──
async function upsertAdSpendRows(rows) {
  if (!rows || !rows.length) return [];
  const BATCH = 200;
  const cols = ["store_name", "spend_date", "amount", "channel", "campaign", "note", "created_at", "updated_at"];

  if (mode === 'postgres' && pool) {
    const saved = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values = [], placeholders = [];
      let idx = 1;
      for (const row of batch) {
        placeholders.push(`(${cols.map(() => '$' + (idx++)).join(',')})`);
        for (const c of cols) values.push(row[c] != null ? row[c] : null);
      }
      try {
        await pool.query(
          `INSERT INTO finance_ad_spend(${cols.map(c => '"' + c + '"').join(',')}) VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
          values
        );
        saved.push(...batch);
      } catch (e) {
        for (const row of batch) {
          try {
            await pool.query(
              `INSERT INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
              [row.store_name, row.spend_date, row.amount, row.channel || '', row.campaign || '', row.note || '', row.created_at, row.updated_at]
            );
            saved.push(row);
          } catch (e2) { /* skip dup */ }
        }
      }
    }
    return saved;
  }

  // Turso & SQLite: simple insert-or-ignore
  return upsertRows('finance_ad_spend', rows, ['store_name', 'spend_date', 'channel', 'campaign']);
}

// ── Schema Init ──
async function initSchema() {
  const ddl = `
    CREATE TABLE IF NOT EXISTS finance_order_lines(line_key TEXT PRIMARY KEY,order_id TEXT,store_name TEXT,source TEXT,created_at TEXT,updated_at TEXT,status TEXT,order_substatus TEXT,sku TEXT,product_name TEXT,variation TEXT,quantity REAL,unit_price REAL,gross_product REAL,seller_discount REAL,platform_discount REAL,platform_fee REAL,refund_amount REAL,order_amount REAL,settlement_received REAL,payment_method TEXT,tracking_id TEXT,package_id TEXT,cancel_reason TEXT,shipped_time TEXT,paid_time TEXT,cancelled_time TEXT,adjustment_amount REAL,last_seen_file TEXT,last_seen_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_sku_costs(sku_key TEXT PRIMARY KEY,store_name TEXT,sku TEXT,product_name TEXT,hpp_per_unit REAL,packing_per_unit REAL,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_ad_spend(id INTEGER PRIMARY KEY AUTOINCREMENT,store_name TEXT,spend_date TEXT,amount REAL,channel TEXT,campaign TEXT,note TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_income_raw(id INTEGER PRIMARY KEY AUTOINCREMENT,store_name TEXT,transaction_type TEXT,order_id TEXT,order_created_time TEXT,settlement_amount REAL,total_fees REAL,refund_amount REAL,adjustment_amount REAL,imported_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_import_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,filename TEXT,kind TEXT,store_name TEXT,rows_seen INTEGER,inserted INTEGER,updated INTEGER,unchanged INTEGER,audit_count INTEGER,message TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_audit_events(id TEXT PRIMARY KEY,run_id INTEGER,filename TEXT,kind TEXT,store_name TEXT,order_id TEXT,sku TEXT,field_name TEXT,old_value TEXT,new_value TEXT,change_type TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS finance_config(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
  `;

  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_ol_store ON finance_order_lines(store_name)",
    "CREATE INDEX IF NOT EXISTS idx_ol_created ON finance_order_lines(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_ir_month ON finance_income_raw(store_name,order_created_time)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_income_event ON finance_income_raw(store_name, order_id, transaction_type, settled_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name, spend_date, channel, campaign)",
  ];

  if (mode === 'postgres' && pool) {
    const pgDdl = ddl
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/TEXT PRIMARY KEY/g, 'TEXT');
    await pool.query(pgDdl);
    for (const idx of indexes.slice(0, 3)) { try { await pool.query(idx); } catch (e) { } }
    // PG: use COALESCE for nullable columns in unique index
    try { await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_income_event ON finance_income_raw(store_name, order_id, transaction_type, settled_at)"); } catch (e) { }
    try { await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unique ON finance_ad_spend(store_name, spend_date, COALESCE(channel,''), COALESCE(campaign,''))"); } catch (e) { }
    return;
  }

  if (mode === 'turso' && turso) {
    // Turso doesn't support multi-statement — split on semicolons
    const stmts = ddl.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try { await turso.execute(stmt + ';'); } catch (e) { /* table may exist */ }
    }
    for (const idx of indexes) { try { await turso.execute(idx); } catch (e) { } }
    return;
  }

  // SQLite local
  const d = getDb(); if (!d) return;
  d.exec(ddl);
  for (const idx of indexes) { try { d.exec(idx); } catch (e) { } }
}

// ── Cache stubs (Supabase cache not used in direct mode) ──
// Simple in-memory cache for summary data to reduce Turso roundtrips
const summaryCache = new Map();
const CACHE_TTL_MS = 30000; // 30 detik cache summary

async function cacheGet(k) {
  const entry = summaryCache.get(k);
  if (entry && (Date.now() - entry.ts) < CACHE_TTL_MS) {
    return entry.data;
  }
  summaryCache.delete(k);
  return null;
}
async function cacheSet(k, d, t) {
  summaryCache.set(k, { data: d, ts: Date.now() });
  if (summaryCache.size > 50) {
    const oldest = [...summaryCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) summaryCache.delete(oldest[0]);
  }
}
async function cacheDelete(p) {
  for (const k of summaryCache.keys()) {
    if (typeof p === 'string' && k.includes(p.replace(/%/g, ''))) {
      summaryCache.delete(k);
    }
  }
}
async function cacheDeleteByTable(t) {
  cacheDelete(t);
}

module.exports = {
  pgConfigured, pgSetupMessage,
  pgQuery, fetchAll,
  upsertRows, insertRows, upsertAdSpendRows,
  initSchema,
  cacheGet, cacheSet, cacheDelete, cacheDeleteByTable,
  getDb,
};
