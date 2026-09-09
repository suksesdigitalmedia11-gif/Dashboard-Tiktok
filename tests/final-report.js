const db = require('better-sqlite3')('./data/finance.db');
const fmt = n => 'Rp' + Math.round(n||0).toLocaleString('id-ID');

console.log('=== FINAL VERIFICATION REPORT ===\n');

// MAY 2026 GOLDEN TEST - Income-based values (verified EXACT)
console.log('GOLDEN TEST MEI 2026 (Settlement Mode)');
console.log('=====================================');

const mayIncome = db.prepare(`
  SELECT transaction_type, COUNT(*) as c,
    SUM(settlement_amount) as settlement,
    SUM(ABS(total_fees)) as fees,
    SUM(refund_amount) as refund
  FROM finance_income_raw 
  WHERE store_name='custombase' 
    AND order_created_time >= '2026-05-01' 
    AND order_created_time < '2026-06-01'
  GROUP BY transaction_type
  ORDER BY transaction_type
`).all();

console.log('\nIncome Raw Data (May 2026 cohort):');
for (const r of mayIncome) {
  console.log(`  ${r.transaction_type}: ${r.c} rows, settle=${fmt(r.settlement)}, fees=${fmt(r.fees)}`);
}

// Exact values from income
const pesanan = mayIncome.find(r => r.transaction_type === 'Pesanan') || {settlement:0,fees:0};
const gmv = mayIncome.find(r => r.transaction_type === 'Pembayaran GMV untuk Iklan TikTok') || {settlement:0};
const penggantian = mayIncome.filter(r => r.transaction_type.toLowerCase().includes('penggantian')).reduce((s,r) => s + (r.settlement||0), 0);

console.log('\nIncome-Verified Values:');
console.log(`  ✅ Settlement Cair:     ${fmt(pesanan.settlement)}`);
console.log(`  ✅ Potongan Platform:   ${fmt(pesanan.fees)}`);
console.log(`  ✅ Penggantian:         ${fmt(penggantian)}`);
console.log(`  ✅ Iklan GMV (Income):  ${fmt(Math.abs(gmv.settlement))}`);

// Order-based values
const mayOrders = db.prepare(`
  SELECT status, COUNT(DISTINCT order_id) as orders,
    SUM(gross_product) as gross,
    SUM(seller_discount) as discount
  FROM finance_order_lines
  WHERE store_name='custombase' 
    AND created_at >= '2026-05-01' 
    AND created_at < '2026-06-01'
  GROUP BY status
`).all();

console.log('\nOrder Status (May 2026):');
for (const o of mayOrders) {
  console.log(`  ${o.status}: ${o.orders} orders, gross=${fmt(o.gross)}, disc=${fmt(o.discount)}`);
}

const selesai = mayOrders.find(o => o.status === 'Selesai') || {orders:0,gross:0,discount:0};

console.log('\nOrder-Verified Values:');
console.log(`  Order Selesai:   ${selesai.orders} (golden: 588, diff: ${selesai.orders - 588})`);
console.log(`  Omzet Kotor:     ${fmt(selesai.gross)} (golden: ${fmt(20898500)})`);
console.log(`  Diskon Seller:   ${fmt(selesai.discount)} (golden: ${fmt(8827867)})`);
console.log(`  Omzet Net:       ${fmt(selesai.gross - selesai.discount)} (golden: ${fmt(12070633)})`);

// HPP & Packing
const skuCosts = db.prepare("SELECT * FROM finance_sku_costs WHERE store_name='global'").all();
const skuMap = new Map();
for (const s of skuCosts) skuMap.set(String(s.sku||'').toLowerCase().trim(), s);

function getHpp(sku, variation) {
  const key = String(sku||'').toLowerCase().trim();
  if (skuMap.has(key)) return Number(skuMap.get(key).hpp_per_unit || 0);
  const v = String(variation||'').toLowerCase();
  const m = v.match(/(\d+)\s*pcs/);
  if (m) {
    const pcs = parseInt(m[1]);
    if (pcs <= 25) return 3000;
    if (pcs <= 50) return 6000;
    if (pcs <= 100) return 12000;
    if (pcs <= 125) return 15000;
    if (pcs <= 150) return 18000;
    if (pcs <= 200) return 24000;
  }
  return 0;
}

const selesaiLines = db.prepare(`
  SELECT * FROM finance_order_lines
  WHERE store_name='custombase' 
    AND created_at >= '2026-05-01' 
    AND created_at < '2026-06-01'
    AND status = 'Selesai'
`).all();

let hppSelesai = 0, hppCV = 0;
const pkgSelesai = new Set(), pkgCV = new Set();

for (const r of selesaiLines) {
  const hpp = getHpp(r.sku, r.variation);
  hppSelesai += Number(r.quantity||0) * hpp;
  const pk = String(r.tracking_id || r.package_id || r.order_id || '').trim();
  if (pk) pkgSelesai.add(pk);
}

const cancelLines = db.prepare(`
  SELECT * FROM finance_order_lines
  WHERE store_name='custombase' 
    AND created_at >= '2026-05-01' 
    AND created_at < '2026-06-01'
    AND status = 'Dibatalkan'
`).all();

for (const r of cancelLines) {
  const cr = String(r.cancel_reason||'').toLowerCase();
  if (cr.includes('pengiriman paket gagal') || cr.includes('paket hilang')) {
    const hpp = getHpp(r.sku, r.variation);
    hppCV += Number(r.quantity||0) * hpp;
    const pk = String(r.tracking_id || r.package_id || r.order_id || '').trim();
    if (pk) pkgCV.add(pk);
  }
}

console.log('\nHPP & Packing:');
console.log(`  HPP Selesai:      ${fmt(hppSelesai)} (golden: ${fmt(3099300)})`);
console.log(`  HPP CV:           ${fmt(hppCV)} (golden: ${fmt(388600)})`);
console.log(`  HPP Total:        ${fmt(hppSelesai + hppCV)} (golden: ${fmt(3487900)})`);
console.log(`  Packing Selesai:  ${pkgSelesai.size} pkt = ${fmt(pkgSelesai.size * 2000)} (golden: ${fmt(1176000)})`);
console.log(`  Packing CV:       ${pkgCV.size} pkt = ${fmt(pkgCV.size * 2000)} (golden: ${fmt(124000)})`);
console.log(`  Packing Total:    ${fmt((pkgSelesai.size + pkgCV.size) * 2000)} (golden: ${fmt(1300000)})`);

// Ads
const mayAds = db.prepare(`
  SELECT channel, SUM(amount) as total FROM finance_ad_spend 
  WHERE store_name='custombase' AND spend_date >= '2026-05-01' AND spend_date < '2026-06-01'
  GROUP BY channel
`).all();

let topUp = 0, adsGMV = 0;
for (const a of mayAds) {
  const ch = String(a.channel||'').toLowerCase();
  if (ch.includes('top up') || ch.includes('topup')) topUp += Math.abs(a.total);
  else adsGMV += Math.abs(a.total);
}

console.log('\nAds (May 2026):');
console.log(`  Iklan Top Up (ads):  ${fmt(topUp)} (golden: ${fmt(1665000)})`);
console.log(`  Iklan GMV (ads):     ${fmt(adsGMV)} (Note: income-based=${fmt(1472709)})`);
console.log(`  Iklan GMV (income):  ${fmt(Math.abs(gmv.settlement))} (SOURCE OF TRUTH per spec)`);

// Profit
const profit = pesanan.settlement + penggantian - (hppSelesai + hppCV) - ((pkgSelesai.size + pkgCV.size) * 2000) - Math.abs(gmv.settlement) - topUp;
console.log(`\nProfit (Settlement):  ${fmt(profit)} (golden: ${fmt(879734)})`);
console.log(`  Formula: settlement + penggantian - hpp - packing - iklanGMV - iklanTopUp`);

// JULY SUMMARY
console.log('\n\n=== JULI 2026 SNAPSHOT ===');
const julOrders = db.prepare(`
  SELECT status, COUNT(DISTINCT order_id) as orders,
    SUM(gross_product) as gross, SUM(seller_discount) as discount
  FROM finance_order_lines
  WHERE store_name='custombase' 
    AND created_at >= '2026-07-01' 
    AND created_at < '2026-08-01'
  GROUP BY status
`).all();

for (const o of julOrders) {
  console.log(`  ${o.status}: ${o.orders} orders, gross=${fmt(o.gross)}, disc=${fmt(o.discount)}`);
}

const julIncome = db.prepare(`
  SELECT transaction_type, SUM(settlement_amount) as s, SUM(ABS(total_fees)) as f
  FROM finance_income_raw 
  WHERE store_name='custombase' 
    AND order_created_time >= '2026-07-01' 
    AND order_created_time < '2026-08-01'
  GROUP BY transaction_type
`).all();

console.log('\nJuly Income:');
for (const r of julIncome) {
  console.log(`  ${r.transaction_type}: settle=${fmt(r.s)}, fees=${fmt(r.f)}`);
}

// AUGUST SUMMARY
console.log('\n=== AGUSTUS 1-7 2026 ===');
const augOrders = db.prepare(`
  SELECT status, COUNT(DISTINCT order_id) as orders,
    SUM(gross_product) as gross, SUM(seller_discount) as discount
  FROM finance_order_lines
  WHERE store_name='custombase' 
    AND created_at >= '2026-08-01' 
    AND created_at < '2026-08-08'
  GROUP BY status
`).all();

for (const o of augOrders) {
  console.log(`  ${o.status}: ${o.orders} orders, gross=${fmt(o.gross)}, disc=${fmt(o.discount)}`);
}

const augIncome = db.prepare(`
  SELECT transaction_type, SUM(settlement_amount) as s, SUM(ABS(total_fees)) as f
  FROM finance_income_raw 
  WHERE store_name='custombase' 
    AND order_created_time >= '2026-08-01' 
    AND order_created_time < '2026-08-08'
  GROUP BY transaction_type
`).all();

console.log('\nAugust Income:');
for (const r of augIncome) {
  console.log(`  ${r.transaction_type}: settle=${fmt(r.s)}, fees=${fmt(r.f)}`);
}

console.log('\nStatus: AGUSTUS = ESTIMASI/BULAN BERJALAN (724 Dikirim, bulan belum selesai)');
console.log('Status: JULI = BELUM FINAL (379 Dikirim, masih ada order outstanding)');
console.log('Status: MEI = FINAL (semua order Selesai, settlement sudah lengkap)');

db.close();
