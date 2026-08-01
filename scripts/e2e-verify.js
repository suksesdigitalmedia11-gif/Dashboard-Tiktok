// END-TO-END VERIFICATION: Multi-store safety
process.env.TURSO_URL = 'libsql://dashboard-keuangan-tiktok-rzkyjlnsyh.aws-us-east-1.turso.io';
process.env.TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUzMDc0MDEsImlkIjoiMDE5ZmFjOWMtYTQwMS03NTI1LTkzMWYtNDczMDg5MTlmMDE4Iiwia2lkIjoiRTdIa2VCNTliR0NSQUE4MHpWQVQ2eU10Z21LQUpMWmJzeTdMc3pRSHZRUSIsInJpZCI6IjY2YzVmNzRjLWViYmItNDlhNS04NDBiLWMwYzAyMGRjZGIxMyJ9.IKw_pDIxdRurxZujjVqQ2YrmlePIg-Nrjw5s3FXcWQ2I24tYdNoKK-NP0mt8G4SbJMHMWwfF2xBzNc242a3gDQ';
delete process.env.DATABASE_URL;

const assert = require('assert');
const finance = require('../lib/finance-cloud');
const pg = require('../lib/pg-connector');
const XLSX = require('xlsx');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');

function readSheet(fpath) {
  const wb = XLSX.readFile(fpath, { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const keys = Object.keys(ws).filter(k => k && k[0] !== '!');
  let maxRow = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxRow) maxRow = c.r; } catch (e) { } }
  if (maxRow > 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: 99 } });
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

const TEST_STORE = 'tokotest123';
const FAIL = [];

async function check(label, fn) {
  try { await fn(); console.log('  ✅ ' + label); } catch (e) { console.log('  ❌ ' + label + ': ' + e.message); FAIL.push(label); }
}

(async () => {
  const t0 = Date.now();
  await pg.initSchema();
  console.log('=== E2E MULTI-STORE VERIFICATION ===\n');

  // ── 1. SAVE NEW STORE ──
  await check('1. Save toko baru ke config', async () => {
    const cfg = await finance.saveConfig({ stores: ['ventura', 'giftyours', 'custombase', TEST_STORE] });
    assert(cfg.stores.includes(TEST_STORE), 'toko baru harus ada di config');
    const read = await finance.readConfig();
    assert(read.stores.includes(TEST_STORE), 'readConfig harus include toko baru');
  });

  // ── 2. availableStores includes new store ──
  await check('2. availableStores dari summary include toko baru', async () => {
    const s = await finance.computeSummary({ preset: 'all', store: 'all' });
    assert(s.availableStores.includes(TEST_STORE), 'availableStores harus include ' + TEST_STORE);
  });

  // ── 3. UPLOAD DATA TO NEW STORE ──
  await check('3. Upload order ke toko baru', async () => {
    // Use a subset of custombase orders, assign to test store
    const orderRows = readSheet(path.join(DATA_DIR, 'semua-pesanan-april-sekarang.xlsx'));
    // Take only 100 rows for speed
    const subset = orderRows.slice(0, 100);
    const r = await finance.importRows({ storeName: TEST_STORE, kind: 'orders', filename: 'test.xlsx', rows: subset });
    assert(r.inserted > 0, 'harus insert minimal 1 row');
  });

  await check('4. Upload SKU ke toko baru', async () => {
    const skuRows = XLSX.utils.sheet_to_json(XLSX.readFile('sku-template.xlsx').Sheets['sku-template'], { defval: '' });
    const r = await finance.importRows({ storeName: TEST_STORE, kind: 'sku', filename: 'sku.xlsx', rows: skuRows });
    assert(r.inserted > 0, 'harus insert SKU');
  });

  // ── 4. DATA ISOLATION ──
  await check('5. Data toko baru tidak bocor ke custombase', async () => {
    const sOld = await finance.computeSummary({ preset: 'all', store: 'custombase' });
    // custombase should still have its original count
    assert(sOld.totals.orders === 11592, 'custombase order count tidak boleh berubah: expected 11592, got ' + sOld.totals.orders);
  });

  await check('6. Data custombase tidak bocor ke toko baru', async () => {
    const sNew = await finance.computeSummary({ preset: 'all', store: TEST_STORE });
    // toko baru should have fewer orders (only 100 test rows)
    assert(sNew.totals.orders < 11592, 'toko baru harus punya order lebih sedikit');
  });

  // ── 5. FILTER "ALL" SEES BOTH ──
  await check('7. Filter "Semua Toko" melihat semua data', async () => {
    const sAll = await finance.computeSummary({ preset: 'all', store: 'all' });
    const sOld = await finance.computeSummary({ preset: 'all', store: 'custombase' });
    const sNew = await finance.computeSummary({ preset: 'all', store: TEST_STORE });
    assert(sAll.totals.orders >= sOld.totals.orders + sNew.totals.orders, 
      'All should >= sum of individual: ' + sAll.totals.orders + ' vs ' + (sOld.totals.orders + sNew.totals.orders));
  });

  // ── 6. STORE NAMES IN DB ARE CORRECT ──
  await check('8. store_name di DB benar', async () => {
    const rows = await pg.pgQuery("SELECT DISTINCT store_name FROM finance_order_lines ORDER BY store_name");
    const names = rows.rows.map(r => r.store_name);
    assert(names.includes(TEST_STORE), 'DB harus punya ' + TEST_STORE);
    assert(names.includes('custombase'), 'DB harus punya custombase');
    console.log('     Stores in DB: ' + names.join(', '));
  });

  // ── 7. CLEANUP ──
  await check('9. Cleanup toko test', async () => {
    await pg.pgQuery("DELETE FROM finance_order_lines WHERE store_name = $1", [TEST_STORE]);
    await pg.pgQuery("DELETE FROM finance_sku_costs WHERE store_name = $1", [TEST_STORE]);
    await finance.saveConfig({ stores: ['ventura', 'giftyours', 'custombase'] });
  });

  // ── 8. AFTER CLEANUP ──
  await check('10. Setelah cleanup, custombase tetap utuh', async () => {
    const s = await finance.computeSummary({ preset: 'all', store: 'custombase' });
    assert(s.totals.orders === 11592, 'custombase harus tetap 11592 orders setelah cleanup, got: ' + s.totals.orders);
  });

  await check('11. availableStores tidak include toko test', async () => {
    const s = await finance.computeSummary({ preset: 'all', store: 'all' });
    assert(!s.availableStores.includes(TEST_STORE), 'availableStores harus bersih');
  });

  console.log('\n========================================');
  if (FAIL.length === 0) {
    console.log('✅ ALL ' + (11) + ' CHECKS PASSED');
    console.log('✅ Multi-store: AMAN, data terisolasi, upload fleksibel');
    console.log('✅ Total time: ' + Math.round((Date.now() - t0) / 1000) + 's');
  } else {
    console.log('❌ FAILED: ' + FAIL.join(', '));
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
