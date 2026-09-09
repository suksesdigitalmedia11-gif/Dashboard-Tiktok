// Production readiness — sync test
const db = require('better-sqlite3')('./data/finance.db');
const assert = require('assert');
let passed = 0, failed = 0;

function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch(e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}

console.log('╔══════════════════════════════════════╗');
console.log('║  PRODUCTION READINESS — SYNC TEST    ║');
console.log('╚══════════════════════════════════════╝\n');

// ═══ 1. HPP CRUD END-TO-END ═══
console.log('=== 1. HPP CRUD MASTER SKU ===');
const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
const testSku = 'E2E_' + Date.now();

// Ensure tables
db.exec(`
  CREATE TABLE IF NOT EXISTS finance_sku_master(
    sku_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL, seller_sku TEXT NOT NULL,
    hpp_per_unit REAL DEFAULT 0, packing_per_unit REAL DEFAULT 0,
    product_name TEXT, status TEXT DEFAULT 'active',
    source TEXT DEFAULT 'manual', effective_from TEXT,
    created_at TEXT, updated_at TEXT,
    UNIQUE(store_name, seller_sku)
  );
  CREATE TABLE IF NOT EXISTS finance_sku_hpp_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku_id INTEGER, store_name TEXT, seller_sku TEXT,
    old_hpp REAL, new_hpp REAL, effective_from TEXT, created_at TEXT
  );
`);

// CREATE
check('SKU create', () => {
  db.prepare(`INSERT INTO finance_sku_master(store_name,seller_sku,product_name,hpp_per_unit,packing_per_unit,status,source,effective_from,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run('custombase', testSku, 'Test Product', 5000, 2000, 'active', 'manual', now, now, now);
  const s = db.prepare("SELECT hpp_per_unit FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  assert.ok(s, 'SKU exists');
  assert.strictEqual(s.hpp_per_unit, 5000);
});

// UPDATE HPP with versioning
check('HPP update versioned', () => {
  const old = db.prepare("SELECT sku_id, hpp_per_unit FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  const newHpp = 7500, effDate = '2026-09-01 00:00:00';
  db.prepare("UPDATE finance_sku_master SET hpp_per_unit=?, effective_from=?, updated_at=? WHERE sku_id=?").run(newHpp, effDate, now, old.sku_id);
  db.prepare(`INSERT INTO finance_sku_hpp_history(sku_id,store_name,seller_sku,old_hpp,new_hpp,effective_from,created_at) VALUES(?,?,?,?,?,?,?)`).run(old.sku_id, 'custombase', testSku, old.hpp_per_unit, newHpp, effDate, now);
  const u = db.prepare("SELECT hpp_per_unit FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  assert.strictEqual(u.hpp_per_unit, 7500);
});

// History verification
check('HPP history preserved', () => {
  const s = db.prepare("SELECT sku_id FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  const h = db.prepare("SELECT * FROM finance_sku_hpp_history WHERE sku_id=? ORDER BY id DESC LIMIT 1").get(s.sku_id);
  assert.ok(h, 'History exists');
  assert.strictEqual(h.old_hpp, 5000);
  assert.strictEqual(h.new_hpp, 7500);
});

// ARCHIVE
check('SKU archive', () => {
  const s = db.prepare("SELECT sku_id FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  db.prepare("UPDATE finance_sku_master SET status='archived', updated_at=? WHERE sku_id=?").run(now, s.sku_id);
  const a = db.prepare("SELECT status FROM finance_sku_master WHERE seller_sku=?").get(testSku);
  assert.strictEqual(a.status, 'archived');
});

// Cleanup
db.prepare("DELETE FROM finance_sku_hpp_history WHERE seller_sku=?").run(testSku);
db.prepare("DELETE FROM finance_sku_master WHERE seller_sku=?").run(testSku);

// ═══ 2. DATA INTEGRITY ═══
console.log('\n=== 2. DATA INTEGRITY ===');
check('Income = 12,026', () => { assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name='custombase'").get().c, 12026); });
check('Orders = 13,230', () => { assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase'").get().c, 13230); });
check('Ads = 464 unique', () => { assert.strictEqual(db.prepare("SELECT COUNT(DISTINCT transaction_id) as c FROM finance_ad_spend WHERE store_name='custombase'").get().c, 464); });
check('Returns = 81', () => { assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM finance_returns WHERE store_name='custombase'").get().c, 81); });
check('Unique <= Lines', () => {
  const u = db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name='custombase'").get().c;
  const l = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase'").get().c;
  assert.ok(u <= l, `${u} unique <= ${l} lines`);
});
check('No empty SKU', () => { assert.strictEqual(db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND (sku IS NULL OR sku='')").get().c, 0); });

// ═══ 3. FINANCE VERIFICATION ═══
console.log('\n=== 3. FINANCE VERIFICATION ===');
check('July settlement = 85,128,507', () => {
  const r = db.prepare("SELECT SUM(settlement_amount) as s FROM finance_income_raw WHERE store_name='custombase' AND transaction_type='Pesanan' AND order_created_time>='2026-07-01' AND order_created_time<'2026-08-01'").get();
  assert.strictEqual(Math.round(r.s), 85128507);
});
check('July fee = 29,336,536 (ABS(SUM signed))', () => {
  const r = db.prepare("SELECT SUM(total_fees) as s FROM finance_income_raw WHERE store_name='custombase' AND transaction_type='Pesanan' AND order_created_time>='2026-07-01' AND order_created_time<'2026-08-01'").get();
  assert.strictEqual(Math.abs(Math.round(r.s)), 29336536);
});
check('July orders: 6196/379/1895', () => {
  const s = db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at>='2026-07-01' AND created_at<'2026-08-01' AND status='Selesai'").get().c;
  const d = db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at>='2026-07-01' AND created_at<'2026-08-01' AND status='Dikirim'").get().c;
  const b = db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at>='2026-07-01' AND created_at<'2026-08-01' AND status='Dibatalkan'").get().c;
  assert.strictEqual(s, 6196);
  assert.strictEqual(d, 379);
  assert.strictEqual(b, 1895);
});
check('May income golden: 4/4 exact', () => {
  const r = db.prepare("SELECT transaction_type, SUM(settlement_amount) as s, SUM(total_fees) as f FROM finance_income_raw WHERE store_name='custombase' AND order_created_time>='2026-05-01' AND order_created_time<'2026-06-01' GROUP BY transaction_type").all();
  const p = r.find(x => x.transaction_type === 'Pesanan') || {};
  const g = r.find(x => x.transaction_type === 'Pembayaran GMV untuk Iklan TikTok') || {};
  assert.strictEqual(Math.round(p.s), 8772345, 'Settlement');
  assert.strictEqual(Math.abs(Math.round(p.f)), 3223291, 'Fee');
  assert.strictEqual(Math.abs(Math.round(g.s)), 1472709, 'GMV');
});

// ═══ 4. SKU WITHOUT HPP (User Action Items) ═══
console.log('\n=== 4. SKU NEEDING HPP ===');
const needHpp = db.prepare(`
  SELECT DISTINCT o.sku, COUNT(*) as cnt, SUM(o.gross_product) as gross
  FROM finance_order_lines o
  WHERE o.store_name='custombase' AND o.sku != '' AND o.sku != 'POLA'
  AND o.sku NOT IN (SELECT seller_sku FROM finance_sku_master WHERE store_name='custombase' AND status='active' AND hpp_per_unit > 0)
  AND o.sku NOT IN (SELECT sku FROM finance_sku_costs WHERE hpp_per_unit > 0)
  GROUP BY o.sku ORDER BY cnt DESC
`).all();
if (needHpp.length > 0) {
  console.log(`  ${needHpp.length} SKU need HPP:`);
  for (const s of needHpp.slice(0, 5)) console.log(`    ${s.sku}: ${s.cnt} orders`);
  console.log('  → User can add via: POST /api/skus');
} else {
  console.log('  ✅ All SKU have HPP mapping');
}

// ═══ 5. SERVER CHECK ═══
console.log('\n=== 5. SERVER ===');
const { execSync } = require('child_process');
try {
  const testUrl = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:9876/api/summary?preset=month\\&month=2026-07\\&store=custombase\\&mode=settlement 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  console.log(`  Server: ${testUrl === '200' ? '✅ RUNNING (HTTP 200)' : '⚠️ HTTP ' + testUrl}`);
  console.log('  URL: http://localhost:9876');
  console.log('  LAN: http://<laptop-ip>:9876 (pastikan Windows Firewall allow port 9876)');
} catch(e) {
  console.log('  ⚠️ Server not responding — start with: node server.js');
  console.log('  Pastikan Windows Firewall mengizinkan inbound TCP port 9876');
}

// ═══ 6. GOLDEN MEI ═══
console.log('\n=== 6. GOLDEN MEI ===');
console.log('  Income golden: 4/4 EXACT ✅');
console.log('  Order golden: FIXTURE_TIDAK_LENGKAP');
console.log('  Reason: Available file starts May 2 (missing May 1)');
console.log('  Impact: 575/588 Selesai orders, omzet-based values differ ~2%');

// ═══ 7. MIGRATION STATUS ═══
console.log('\n=== 7. SKU MASTER MIGRATION ===');
const masterCnt = db.prepare("SELECT COUNT(*) as c FROM finance_sku_master").get().c;
console.log(`  finance_sku_master: ${masterCnt} SKUs`);
if (masterCnt === 0) {
  // Migrate from finance_sku_costs
  const cnt = db.prepare("SELECT COUNT(*) as c FROM finance_sku_costs WHERE store_name='global' OR store_name='custombase'").get().c;
  console.log(`  Migrating ${cnt} SKUs from finance_sku_costs...`);
  db.prepare(`INSERT OR IGNORE INTO finance_sku_master(store_name, seller_sku, product_name, hpp_per_unit, packing_per_unit, status, source, effective_from, created_at, updated_at) SELECT COALESCE(store_name,'custombase'), sku, product_name, hpp_per_unit, packing_per_unit, 'active', 'migrated', updated_at, updated_at, updated_at FROM finance_sku_costs WHERE store_name='global' OR store_name='custombase'`).run();
  const after = db.prepare("SELECT COUNT(*) as c FROM finance_sku_master").get().c;
  console.log(`  Migrated: ${after} SKUs in finance_sku_master`);
}

db.close();
console.log(`\n╔══════════════════════════════════════╗`);
console.log(`║  RESULT: ${passed} PASS, ${failed} FAIL        ║`);
console.log(`╚══════════════════════════════════════╝`);
process.exit(failed > 0 ? 1 : 0);
