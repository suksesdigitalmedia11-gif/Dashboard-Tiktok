// Quick import: Juni income + ads to Turso
process.env.TURSO_URL = 'libsql://dashboard-keuangan-tiktok-rzkyjlnsyh.aws-us-east-1.turso.io';
process.env.TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUzMDc0MDEsImlkIjoiMDE5ZmFjOWMtYTQwMS03NTI1LTkzMWYtNDczMDg5MTlmMDE4Iiwia2lkIjoiRTdIa2VCNTliR0NSQUE4MHpWQVQ2eU10Z21LQUpMWmJzeTdMc3pRSHZRUSIsInJpZCI6IjY2YzVmNzRjLWViYmItNDlhNS04NDBiLWMwYzAyMGRjZGIxMyJ9.IKw_pDIxdRurxZujjVqQ2YrmlePIg-Nrjw5s3FXcWQ2I24tYdNoKK-NP0mt8G4SbJMHMWwfF2xBzNc242a3gDQ';
delete process.env.DATABASE_URL;

const finance = require('../lib/finance-cloud');
const pg = require('../lib/pg-connector');
const XLSX = require('xlsx');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');

function readSheet(fpath) {
  const wb = XLSX.readFile(fpath, { cellDates: false, raw: true });
  const sn = wb.SheetNames[0];
  const ws = wb.Sheets[sn];
  const keys = Object.keys(ws).filter(k => k && k[0] !== '!');
  let maxRow = 0, maxCol = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxRow) maxRow = c.r; if (c.c > maxCol) maxCol = c.c; } catch(e) {} }
  if (maxRow > 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

(async () => {
  const t0 = Date.now();
  await pg.initSchema();

  // Juni income
  console.log('Importing Juni income...');
  const rows = readSheet(path.join(DATA_DIR, 'penarikan-dana-juni-sekarang.xlsx'));
  console.log('  Rows:', rows.length);
  const r = await finance.importRows({ storeName: 'custombase', kind: 'income', filename: 'juni-sekarang.xlsx', rows });
  console.log('  OK updated=' + r.updated + ' matched=' + (r.matchedOrders||0) + ' adSpend=' + (r.adSpendTotal||0).toLocaleString('id-ID'));

  // Ads
  console.log('Importing ads...');
  const adRows = readSheet(path.join(DATA_DIR, 'custombase-iklan-april-sekarang.xlsx'));
  console.log('  Rows:', adRows.length);
  const r2 = await finance.importRows({ storeName: 'custombase', kind: 'ads', filename: 'ads.xlsx', rows: adRows });
  console.log('  OK inserted=' + (r2.inserted||0) + ' adSpend=' + (r2.adSpendTotal||0).toLocaleString('id-ID'));

  // Verify
  console.log('\n=== VERIFY ===');
  const s = await finance.computeSummary({ preset: 'thisMonth', store: 'custombase' });
  const t = s.totals;
  console.log('Orders: ' + t.orders + ' | Omzet: Rp' + Math.round(t.omzet).toLocaleString('id-ID'));
  console.log('Settlement: Rp' + Math.round(t.settlement).toLocaleString('id-ID'));
  console.log('PlatformFee: Rp' + Math.round(t.platformFee).toLocaleString('id-ID'));
  console.log('Refund: Rp' + Math.round(t.refund).toLocaleString('id-ID'));
  console.log('HPP: Rp' + Math.round(t.hpp).toLocaleString('id-ID') + ' | Packing: Rp' + Math.round(t.packing).toLocaleString('id-ID'));
  console.log('Ad GMV: Rp' + Math.round(t.adSpendSettlement).toLocaleString('id-ID') + ' | Ad Topup: Rp' + Math.round(t.adSpendTopup).toLocaleString('id-ID'));
  console.log('PROFIT: Rp' + Math.round(t.profit).toLocaleString('id-ID') + ' | Margin: ' + (t.margin||0).toFixed(1) + '%');
  console.log('Total: ' + Math.round((Date.now()-t0)/1000) + 's ✅');
})().catch(e => { console.error(e.message); process.exit(1); });
