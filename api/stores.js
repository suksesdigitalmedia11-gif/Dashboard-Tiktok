// Stores CRUD API
const { json, nowIso } = require("../lib/finance-cloud");
const pg = require("../lib/pg-connector");

async function ensureStoresTable() {
  await pg.pgQuery(`
    CREATE TABLE IF NOT EXISTS finance_stores(
      store_id TEXT PRIMARY KEY,
      store_name TEXT NOT NULL,
      platform TEXT DEFAULT 'TikTok',
      packing_method TEXT DEFAULT 'PER_PACKAGE',
      packing_amount REAL DEFAULT 2000,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT
    )
  `, []);
  // Seed default stores if empty
  const existing = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_stores", []);
  if (existing.rows[0].c === 0) {
    const stores = [
      ['custombase', 'Custombase', 'TikTok', 'PER_PACKAGE', 2000],
      ['ventura', 'Ventura', 'TikTok', 'PER_PACKAGE', 2000],
      ['giftyours', 'Giftyours', 'TikTok', 'PER_PACKAGE', 2000],
    ];
    const now = nowIso();
    for (const [id, name, plat, method, amt] of stores) {
      await pg.pgQuery(
        `INSERT INTO finance_stores(store_id, store_name, platform, packing_method, packing_amount, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`,
        [id, name, plat, method, amt, 'active', now, now]
      );
    }
  }
}

module.exports = async function handler(req, res) {
  await ensureStoresTable();
  
  const url = new URL(req.url, 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const storeId = pathParts[2]; // /api/stores/:id
  
  try {
    // GET /api/stores or GET /api/stores/:id
    if (req.method === 'GET') {
      if (storeId) {
        const r = await pg.pgQuery("SELECT * FROM finance_stores WHERE store_id=?", [storeId]);
        if (!r.rows.length) return json(res, 404, { ok: false, error: 'Store tidak ditemukan' });
        return json(res, 200, { ok: true, store: r.rows[0] });
      }
      const r = await pg.pgQuery("SELECT * FROM finance_stores ORDER BY store_name", []);
      return json(res, 200, { ok: true, stores: r.rows });
    }
    
    // POST /api/stores
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { store_id, store_name, platform, packing_method, packing_amount } = body;
      if (!store_id || !store_name) return json(res, 400, { ok: false, error: 'store_id dan store_name wajib diisi' });
      
      const now = nowIso();
      await pg.pgQuery(
        `INSERT INTO finance_stores(store_id, store_name, platform, packing_method, packing_amount, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`,
        [store_id, store_name, platform || 'TikTok', packing_method || 'PER_PACKAGE', packing_amount || 2000, 'active', now, now]
      );
      return json(res, 201, { ok: true, message: 'Store berhasil dibuat', store_id });
    }
    
    // PUT /api/stores/:id
    if (req.method === 'PUT') {
      if (!storeId) return json(res, 400, { ok: false, error: 'Store ID wajib diisi' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const now = nowIso();
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(body)) {
        if (['store_name', 'platform', 'packing_method', 'packing_amount', 'status'].includes(k)) {
          sets.push(`${k}=?`);
          vals.push(v);
        }
      }
      if (!sets.length) return json(res, 400, { ok: false, error: 'Tidak ada field yang diupdate' });
      sets.push('updated_at=?');
      vals.push(now);
      vals.push(storeId);
      
      await pg.pgQuery(`UPDATE finance_stores SET ${sets.join(',')} WHERE store_id=?`, vals);
      return json(res, 200, { ok: true, message: 'Store berhasil diupdate' });
    }
    
    // DELETE /api/stores/:id → ARCHIVE
    if (req.method === 'DELETE') {
      if (!storeId) return json(res, 400, { ok: false, error: 'Store ID wajib diisi' });
      // Check if store has transactions
      const hasOrders = await pg.pgQuery("SELECT 1 FROM finance_order_lines WHERE store_name=? LIMIT 1", [storeId]);
      if (hasOrders.rows.length) {
        // Archive instead of delete
        await pg.pgQuery("UPDATE finance_stores SET status='archived', updated_at=? WHERE store_id=?", [nowIso(), storeId]);
        return json(res, 200, { ok: true, message: 'Store di-archive karena memiliki transaksi', archived: true });
      }
      await pg.pgQuery("DELETE FROM finance_stores WHERE store_id=?", [storeId]);
      return json(res, 200, { ok: true, message: 'Store berhasil dihapus' });
    }
    
    return json(res, 405, { ok: false, error: 'Method tidak didukung' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
};
