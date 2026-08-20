// SKU Master CRUD API — Triple-mode compatible (SQLite / Turso / PostgreSQL)
// Fix: ganti BIGSERIAL→INTEGER, ILIKE→lower() LIKE, ON CONFLICT→upsertRows helper
const { json, nowIso, normalizeStore } = require("../lib/finance-cloud");
const pg = require("../lib/pg-connector");

// Deteksi mode dari pg-connector (pg exposes getDb — non-null ↔ sqlite)
function isPostgres() {
  // pg-connector ekspos getDb() yang return null hanya di postgres mode
  try { return pg.getDb && pg.getDb() === null && !process.env.TURSO_URL; } catch (e) { return false; }
}

async function ensureSkuTables() {
  // Gunakan DDL yang compatible semua mode (SQLite / Turso / PG)
  // INTEGER PRIMARY KEY AUTOINCREMENT → SQLite; pg-connector DDL akan handle PG via initSchema
  const ddlMaster = `CREATE TABLE IF NOT EXISTS finance_sku_master(
    sku_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL DEFAULT 'global',
    seller_sku TEXT NOT NULL,
    platform_sku_id TEXT DEFAULT '',
    product_name TEXT DEFAULT '',
    variation TEXT DEFAULT '',
    hpp_per_unit REAL DEFAULT 0,
    packing_per_unit REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    source TEXT DEFAULT 'manual',
    effective_from TEXT,
    created_at TEXT,
    updated_at TEXT
  )`;
  const ddlHistory = `CREATE TABLE IF NOT EXISTS finance_sku_hpp_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku_id INTEGER,
    store_name TEXT,
    seller_sku TEXT,
    old_hpp REAL,
    new_hpp REAL,
    old_packing REAL,
    new_packing REAL,
    effective_from TEXT,
    changed_by TEXT DEFAULT 'user',
    created_at TEXT
  )`;
  const ddls = [
    ddlMaster,
    ddlHistory,
    `CREATE INDEX IF NOT EXISTS idx_skum_store ON finance_sku_master(store_name)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_skum_unique ON finance_sku_master(store_name, seller_sku)`,
    `CREATE INDEX IF NOT EXISTS idx_skuh_sku ON finance_sku_hpp_history(sku_id)`,
  ];
  for (const sql of ddls) {
    try { await pg.pgQuery(sql, []); } catch (e) { /* ok — table/index sudah ada */ }
  }
  // Migrasi dari finance_sku_costs jika master masih kosong
  try {
    const existing = await pg.pgQuery("SELECT COUNT(*) AS c FROM finance_sku_master", []);
    const count = Number((existing.rows[0] || {}).c || 0);
    if (count === 0) {
      const costs = await pg.pgQuery("SELECT * FROM finance_sku_costs", []);
      for (const row of (costs.rows || [])) {
        try {
          await pg.pgQuery(
            `INSERT INTO finance_sku_master(store_name, seller_sku, product_name, hpp_per_unit, packing_per_unit, status, source, effective_from, created_at, updated_at)
             VALUES(?,?,?,?,?,'active','migrated',?,?,?)`,
            [row.store_name || "global", row.sku, row.product_name || "",
            Number(row.hpp_per_unit) || 0, Number(row.packing_per_unit) || 0,
            row.updated_at, row.updated_at, row.updated_at]
          );
        } catch (e) { /* skip duplicates */ }
      }
    }
  } catch (e) { /* migration optional */ }
}

module.exports = async function handler(req, res) {
  try { await ensureSkuTables(); } catch (e) { console.error("[skus] schema error:", e.message); }

  const url = new URL(req.url, "http://localhost");
  const pathParts = url.pathname.split("/").filter(Boolean);
  const skuId = pathParts[1] && !isNaN(pathParts[1]) ? parseInt(pathParts[1]) : null;
  const subResource = pathParts[2];
  const query = req.query || {};

  try {
    // ─── GET /api/skus ───
    if (req.method === "GET" && !skuId) {
      const params = [];
      let sql = "SELECT * FROM finance_sku_master WHERE 1=1";
      if (query.store && query.store !== "all") {
        params.push(query.store);
        params.push("global");
        sql += " AND (store_name = ? OR store_name = ?)";
      }
      if (query.status) {
        params.push(query.status);
        sql += " AND status = ?";
      }
      if (query.search) {
        // Gunakan lower() + LIKE (kompatibel SQLite/Turso/PG)
        const likeVal = "%" + query.search.toLowerCase() + "%";
        params.push(likeVal);
        params.push(likeVal);
        sql += " AND (lower(seller_sku) LIKE ? OR lower(product_name) LIKE ?)";
      }
      sql += " ORDER BY store_name, seller_sku";
      const limit = parseInt(query.limit) || 1000;
      params.push(limit);
      sql += " LIMIT ?";
      // normalizeSql() tidak dipakai di sini karena kita sudah pakai ? placeholder
      const r = await pg.pgQuery(sql, params);
      return json(res, 200, { ok: true, skus: r.rows || [], total: (r.rows || []).length });
    }

    // ─── GET /api/skus/:id ───
    if (req.method === "GET" && skuId && !subResource) {
      const r = await pg.pgQuery("SELECT * FROM finance_sku_master WHERE sku_id = ?", [skuId]);
      if (!(r.rows || []).length) return json(res, 404, { ok: false, error: "SKU tidak ditemukan" });
      return json(res, 200, { ok: true, sku: r.rows[0] });
    }

    // ─── GET /api/skus/:id/history ───
    if (req.method === "GET" && skuId && subResource === "history") {
      const r = await pg.pgQuery(
        "SELECT * FROM finance_sku_hpp_history WHERE sku_id = ? ORDER BY created_at DESC LIMIT 50",
        [skuId]
      );
      return json(res, 200, { ok: true, history: r.rows || [] });
    }

    // ─── Baca body untuk write methods ───
    let body = {};
    if (req.method !== "GET") {
      try {
        if (typeof req.body === "string") body = JSON.parse(req.body);
        else if (req.body && typeof req.body === "object") body = req.body;
        else {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const text = Buffer.concat(chunks).toString("utf8");
          body = text ? JSON.parse(text) : {};
        }
      } catch (e) { body = {}; }
    }

    // ─── POST /api/skus — tambah SKU baru ───
    if (req.method === "POST" && !skuId) {
      const { seller_sku, platform_sku_id, product_name, variation, hpp_per_unit, packing_per_unit, effective_from } = body;
      let store_name = body.store_name;
      if (!seller_sku) return json(res, 400, { ok: false, error: "seller_sku wajib diisi" });
      const resolvedStore = (!store_name || store_name === "all" || store_name === "global")
        ? "global" : normalizeStore(store_name);
      const now = nowIso();
      const effDate = effective_from || now.slice(0, 10);
      // Cek duplikat dulu
      const dup = await pg.pgQuery(
        "SELECT sku_id FROM finance_sku_master WHERE store_name = ? AND seller_sku = ? LIMIT 1",
        [resolvedStore, seller_sku.trim()]
      );
      if ((dup.rows || []).length) {
        return json(res, 409, { ok: false, error: "SKU '" + seller_sku + "' sudah ada untuk toko '" + resolvedStore + "'. Gunakan Edit untuk ubah HPP." });
      }
      await pg.pgQuery(
        `INSERT INTO finance_sku_master(store_name, seller_sku, platform_sku_id, product_name, variation, hpp_per_unit, packing_per_unit, status, source, effective_from, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,'active','manual',?,?,?)`,
        [resolvedStore, seller_sku.trim(), platform_sku_id || "", product_name || "", variation || "",
          Number(hpp_per_unit) || 0, Number(packing_per_unit) || 0, effDate, now, now]
      );
      const newSku = await pg.pgQuery(
        "SELECT sku_id FROM finance_sku_master WHERE store_name = ? AND seller_sku = ? ORDER BY sku_id DESC LIMIT 1",
        [resolvedStore, seller_sku.trim()]
      );
      const newId = (newSku.rows || [])[0] && newSku.rows[0].sku_id;
      // Sync ke finance_sku_costs
      await syncToSkuCosts(resolvedStore, seller_sku.trim(), product_name || "", Number(hpp_per_unit) || 0, Number(packing_per_unit) || 0);
      // Log history jika ada HPP
      if (newId && (Number(hpp_per_unit) || 0) > 0) {
        try {
          await pg.pgQuery(
            `INSERT INTO finance_sku_hpp_history(sku_id, store_name, seller_sku, old_hpp, new_hpp, old_packing, new_packing, effective_from, created_at)
             VALUES(?,?,?,0,?,0,?,?,?)`,
            [newId, resolvedStore, seller_sku.trim(), Number(hpp_per_unit) || 0, Number(packing_per_unit) || 0, effDate, now]
          );
        } catch (e) { /* optional */ }
      }
      return json(res, 201, { ok: true, message: "SKU berhasil dibuat", sku_id: newId });
    }

    // ─── PUT /api/skus/:id — update SKU ───
    if (req.method === "PUT" && skuId) {
      const existing = await pg.pgQuery("SELECT * FROM finance_sku_master WHERE sku_id = ?", [skuId]);
      if (!(existing.rows || []).length) return json(res, 404, { ok: false, error: "SKU tidak ditemukan" });
      const old = existing.rows[0];
      const now = nowIso();
      const sets = [], vals = [];
      for (const k of ["product_name", "variation", "platform_sku_id", "status"]) {
        if (body[k] !== undefined) { vals.push(body[k]); sets.push(k + " = ?"); }
      }
      const newHpp = body.hpp_per_unit !== undefined ? Number(body.hpp_per_unit) : null;
      const newPacking = body.packing_per_unit !== undefined ? Number(body.packing_per_unit) : null;
      const hppChanged = newHpp !== null && newHpp !== Number(old.hpp_per_unit);
      const packingChanged = newPacking !== null && newPacking !== Number(old.packing_per_unit);
      if (hppChanged) {
        vals.push(newHpp); sets.push("hpp_per_unit = ?");
        const effDate = body.effective_from || now.slice(0, 10);
        vals.push(effDate); sets.push("effective_from = ?");
        try {
          await pg.pgQuery(
            `INSERT INTO finance_sku_hpp_history(sku_id, store_name, seller_sku, old_hpp, new_hpp, old_packing, new_packing, effective_from, created_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
            [skuId, old.store_name, old.seller_sku,
              Number(old.hpp_per_unit) || 0, newHpp,
              Number(old.packing_per_unit) || 0, newPacking !== null ? newPacking : Number(old.packing_per_unit) || 0,
              body.effective_from || now.slice(0, 10), now]
          );
        } catch (e) { /* optional */ }
      }
      if (packingChanged) { vals.push(newPacking); sets.push("packing_per_unit = ?"); }
      if (!sets.length) return json(res, 400, { ok: false, error: "Tidak ada field yang diupdate" });
      vals.push(now); sets.push("updated_at = ?");
      vals.push(skuId);
      await pg.pgQuery("UPDATE finance_sku_master SET " + sets.join(", ") + " WHERE sku_id = ?", vals);
      const updatedHpp = hppChanged ? newHpp : Number(old.hpp_per_unit) || 0;
      const updatedPacking = packingChanged ? newPacking : Number(old.packing_per_unit) || 0;
      const updatedProduct = body.product_name !== undefined ? body.product_name : (old.product_name || "");
      await syncToSkuCosts(old.store_name, old.seller_sku, updatedProduct, updatedHpp, updatedPacking);
      return json(res, 200, { ok: true, message: "SKU berhasil diupdate" });
    }

    // ─── DELETE /api/skus/:id — archive jika ada transaksi ───
    if (req.method === "DELETE" && skuId) {
      const existing = await pg.pgQuery("SELECT * FROM finance_sku_master WHERE sku_id = ?", [skuId]);
      if (!(existing.rows || []).length) return json(res, 404, { ok: false, error: "SKU tidak ditemukan" });
      const sku = existing.rows[0];
      const hasOrders = await pg.pgQuery(
        "SELECT 1 FROM finance_order_lines WHERE sku = ? LIMIT 1",
        [sku.seller_sku]
      );
      if ((hasOrders.rows || []).length) {
        await pg.pgQuery(
          "UPDATE finance_sku_master SET status = 'archived', updated_at = ? WHERE sku_id = ?",
          [nowIso(), skuId]
        );
        return json(res, 200, { ok: true, message: "SKU di-archive karena memiliki transaksi", archived: true });
      }
      await pg.pgQuery("DELETE FROM finance_sku_master WHERE sku_id = ?", [skuId]);
      try {
        await pg.pgQuery("DELETE FROM finance_sku_costs WHERE sku = ? AND store_name = ?", [sku.seller_sku, sku.store_name]);
      } catch (e) { /* optional */ }
      return json(res, 200, { ok: true, message: "SKU berhasil dihapus" });
    }

    return json(res, 405, { ok: false, error: "Method tidak didukung" });
  } catch (e) {
    console.error("[skus] error:", e.message, e.stack ? e.stack.substring(0, 300) : "");
    return json(res, 500, { ok: false, error: e.message });
  }
};

// Sync ke finance_sku_costs agar computeSummary ikut terupdate
// ALWAYS save as store_name='global' — HPP berlaku semua toko
async function syncToSkuCosts(storeName, sellerSku, productName, hppPerUnit, packingPerUnit) {
  // HPP bersifat global: satu SKU = satu HPP untuk semua toko
  const globalKey = 'global|' + sellerSku.toLowerCase();
  const now = nowIso();
  try {
    const ex = await pg.pgQuery("SELECT 1 FROM finance_sku_costs WHERE sku_key = ?", [globalKey]);
    if ((ex.rows || []).length) {
      await pg.pgQuery(
        "UPDATE finance_sku_costs SET store_name='global', sku=?, product_name=?, hpp_per_unit=?, packing_per_unit=?, updated_at=? WHERE sku_key=?",
        [sellerSku, productName || "", Number(hppPerUnit) || 0, Number(packingPerUnit) || 0, now, globalKey]
      );
    } else {
      await pg.pgQuery(
        "INSERT INTO finance_sku_costs(sku_key, store_name, sku, product_name, hpp_per_unit, packing_per_unit, updated_at) VALUES(?,'global',?,?,?,?,?)",
        [globalKey, sellerSku, productName || "", Number(hppPerUnit) || 0, Number(packingPerUnit) || 0, now]
      );
    }
  } catch (e) { console.error("[skus] syncToSkuCosts failed:", e.message); }
}

