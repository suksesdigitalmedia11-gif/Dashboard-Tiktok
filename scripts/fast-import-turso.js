// Fast import: raw income + ads directly to Turso (skip per-row order matching for speed)
process.env.TURSO_URL = 'libsql://dashboard-keuangan-tiktok-rzkyjlnsyh.aws-us-east-1.turso.io';
process.env.TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUzMDc0MDEsImlkIjoiMDE5ZmFjOWMtYTQwMS03NTI1LTkzMWYtNDczMDg5MTlmMDE4Iiwia2lkIjoiRTdIa2VCNTliR0NSQUE4MHpWQVQ2eU10Z21LQUpMWmJzeTdMc3pRSHZRUSIsInJpZCI6IjY2YzVmNzRjLWViYmItNDlhNS04NDBiLWMwYzAyMGRjZGIxMyJ9.IKw_pDIxdRurxZujjVqQ2YrmlePIg-Nrjw5s3FXcWQ2I24tYdNoKK-NP0mt8G4SbJMHMWwfF2xBzNc242a3gDQ';
delete process.env.DATABASE_URL;

const pg = require('../lib/pg-connector');
const finance = require('../lib/finance-cloud');
const XLSX = require('xlsx');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');
const STORE = 'custombase';

function readSheet(fpath) {
  const wb = XLSX.readFile(fpath, { cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const keys = Object.keys(ws).filter(k => k && k[0] !== '!');
  let maxRow = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxRow) maxRow = c.r; } catch(e) {} }
  if (maxRow > 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: 99 } });
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function rupiah(v) {
  if (typeof v === 'number') return Math.round(v);
  const t = String(v||'').trim();
  if (!t) return 0;
  const n = Number(String(t).replace(/[^\d.-]/g, ''));
  return Math.round(Math.abs(isNaN(n)?0:n));
}

(async () => {
  const t0 = Date.now();
  await pg.initSchema();

  // 1. Import Juni raw income — direct batch insert
  console.log('1/2 Raw income (Juni)...');
  const incomeRows = readSheet(path.join(DATA_DIR, 'penarikan-dana-juni-sekarang.xlsx'));
  
  // Also include april-mei if not already imported (check DB)
  const existingRaw = await pg.pgQuery("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name='custombase'");
  console.log('  Existing raw income:', existingRaw.rows[0].c);
  
  // Map to raw format
  const rawIncome = [];
  const adSpendByKey = new Map();
  for (const row of incomeRows) {
    const type = String(row['Jenis transaksi'] || '').trim();
    const orderId = String(row['ID pesanan terkait'] || row['ID Pesanan/Penyesuaian'] || '').trim().replace(/\/\t?/, '');
    if (!orderId) continue;
    
    rawIncome.push({
      store_name: STORE,
      transaction_type: type,
      order_id: orderId,
      order_created_time: String(row['Waktu pemesanan'] || '').trim().replace(/\//g, '-').slice(0, 10),
      settlement_amount: rupiah(row['Jumlah penyelesaian pembayaran']),
      total_fees: Math.abs(rupiah(row['Total Biaya'])),
      refund_amount: Math.abs(rupiah(row['Subtotal pengembalian dana setelah diskon penjual'])),
      adjustment_amount: rupiah(row['Jumlah penyesuaian']),
      imported_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  }
  console.log('  Rows:', rawIncome.length);
  
  // Batch insert raw income (200 per batch)
  const BATCH = 200;
  let inserted = 0;
  for (let i = 0; i < rawIncome.length; i += BATCH) {
    const batch = rawIncome.slice(i, i + BATCH);
    const cols = Object.keys(batch[0]);
    const values = [], phs = [];
    for (const r of batch) {
      phs.push('(' + cols.map(() => '?').join(',') + ')');
      for (const c of cols) values.push(r[c] != null ? r[c] : null);
    }
    try {
      await pg.pgQuery(
        `INSERT INTO finance_income_raw(${cols.map(c=>'"'+c+'"').join(',')}) VALUES ${phs.join(',')} ON CONFLICT (store_name, order_id, transaction_type) DO NOTHING`,
        values
      );
      inserted += batch.length;
    } catch(e) {}
  }
  console.log('  Inserted:', inserted, '(' + Math.round((Date.now()-t0)/1000) + 's)');

  // 2. Import ads
  console.log('2/2 Ads...');
  const adRows = readSheet(path.join(DATA_DIR, 'custombase-iklan-april-sekarang.xlsx'));
  const adResult = await finance.importRows({ storeName: STORE, kind: 'ads', filename: 'ads.xlsx', rows: adRows });
  console.log('  Inserted:', adResult.inserted || adResult.adSpendRows, '(' + Math.round((Date.now()-t0)/1000) + 's)');

  // 3. Verify
  console.log('\n=== FINAL VERIFY ===');
  const s = await finance.computeSummary({ preset: 'thisMonth', store: STORE });
  const t = s.totals;
  console.log('Orders: ' + t.orders + ' | Omzet: Rp' + Math.round(t.omzet).toLocaleString('id-ID'));
  console.log('Settlement: Rp' + Math.round(t.settlement).toLocaleString('id-ID'));
  console.log('Platform Fee: Rp' + Math.round(t.platformFee).toLocaleString('id-ID'));
  console.log('Refund: Rp' + Math.round(t.refund).toLocaleString('id-ID'));
  console.log('HPP: Rp' + Math.round(t.hpp).toLocaleString('id-ID') + ' | Packing: Rp' + Math.round(t.packing).toLocaleString('id-ID'));
  console.log('Ad GMV: Rp' + Math.round(t.adSpendSettlement).toLocaleString('id-ID') + ' | Ad Topup: Rp' + Math.round(t.adSpendTopup).toLocaleString('id-ID'));
  console.log('Ad Total: Rp' + Math.round(t.adSpend).toLocaleString('id-ID'));
  console.log('PROFIT: Rp' + Math.round(t.profit).toLocaleString('id-ID') + ' | Margin: ' + (t.margin||0).toFixed(1) + '%');
  console.log('\nTotal: ' + Math.round((Date.now()-t0)/1000) + 's ✅');
})().catch(e => { console.error(e.message); process.exit(1); });
