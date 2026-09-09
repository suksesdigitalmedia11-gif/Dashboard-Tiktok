/**
 * FINAL ACCEPTANCE FIXES — All 10 items
 * 
 * #1: August Dana Tertahan — full refund exclusion  
 * #2: Return-risk tracking (July + August)
 * #4: Iklan Top Up May — correct classification (Add balance + Bank transfer only)
 * #6: July HPP/Packing — exact verification
 * #7: Card Retur/Cancel — completed return unique orders + cancel
 * #8: UPSERT test — verify UPDATE works
 * #9: Don't break existing acceptance
 */
const db = require('better-sqlite3')('./data/finance.db');
const fmt = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const ct = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const STORE = 'custombase';

console.log('╔══════════════════════════════════════════╗');
console.log('║  FINAL ACCEPTANCE FIXES                  ║');
console.log('╚══════════════════════════════════════════╝\n');

// ═══════════════════════════════════════════
// #4: FIX IKLAN TOP UP MAY
// ═══════════════════════════════════════════
console.log('=== #4: IKLAN TOP UP MAY ===');

// Current May Top Up (all channels)
const currentMayTopUp = db.prepare(`
  SELECT SUM(amount) as s FROM finance_ad_spend 
  WHERE store_name=? AND channel='TikTok Top Up' 
  AND spend_date >= '2026-05-01' AND spend_date < '2026-06-01'
`).get(STORE);
console.log(`  Current Top Up (all): ${fmt(currentMayTopUp.s)}`);

// Re-read raw ads file and re-classify correctly
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function rp_s(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const t = String(v || '').trim(); if (!t) return 0;
  const neg = /^-/.test(t); let n = t.replace(/[^\d,.\-]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  const p = Number.parseFloat(n.replace(/,/g, ''));
  return Number.isFinite(p) ? Math.round(Math.abs(p) * (neg ? -1 : 1)) : 0;
}
function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + v * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = String(v).trim();
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (slash) {
    const y = slash[3].length === 2 ? '20' + slash[3] : slash[3];
    return `${y}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')} ${(slash[4] || '00').padStart(2, '0')}:${(slash[5] || '00').padStart(2, '0')}`;
  }
  const iso = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')} ${(iso[4] || '00').padStart(2, '0')}:${(iso[5] || '00').padStart(2, '0')}`;
  }
  return '';
}
function field(row, ...names) { for (const n of names) if (row[n] !== undefined) return row[n]; return ''; }

function readSheet(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
  const keys = Object.keys(sheet).filter(k => k[0] !== '!');
  let maxR = 0, maxC = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; } catch (e) { } }
  const headers = [];
  for (let c = 0; c <= maxC; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v || '').trim() : `[col_${c}]`);
  }
  const rows = [];
  for (let r = 1; r <= maxR; r++) {
    const row = {};
    for (let c = 0; c <= maxC; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== '') row[headers[c]] = cell.v;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

const DATA_DIR = path.join(__dirname, '..', 'data tiktok', 'custombase');
const adFile = path.join(DATA_DIR, 'iklan custombase mei - akhir juni.xlsx');
const wb = XLSX.readFile(adFile, { cellDates: false, raw: true });
const adRows = readSheet(wb, 'sheet1');

// Rebuild ads with CORRECT classification
db.prepare("DELETE FROM finance_ad_spend WHERE store_name=?").run(STORE);

const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
const adStmt = db.prepare(`
  INSERT INTO finance_ad_spend(store_name, spend_date, amount, channel, campaign, note, created_at, updated_at, transaction_id)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

let topUpMay = 0, gmvTotal = 0, totalSuccess = 0, totalFailed = 0, totalInserted = 0;
const topUpMayDetails = [];

for (const row of adRows) {
  const status = String(field(row, 'Status') || '').trim();
  const txnType = String(field(row, 'Transaction type') || '').trim();
  const txnSubtype = String(field(row, 'Transaction subtype') || '').trim();
  const desc = String(field(row, 'Description') || '').trim();
  const txnId = String(field(row, 'Transaction ID') || '').trim();
  if (!txnId) continue;

  const amount = rp_s(field(row, 'Amount'));
  if (!amount) continue;

  let spendDate = parseDate(field(row, 'Transaction time')).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) continue;

  if (status === 'Success') totalSuccess++;
  else if (status === 'Failed') { totalFailed++; continue; }
  else continue;

  let channel = '', campaign = '';

  // CORRECT CLASSIFICATION per spec:
  // Top Up Bank = Add balance + Success + Description contains "Bank transfer"
  // GMV Pay in description is NOT top up
  // Bill payment = GMV auto settlement
  if (txnType === 'General' && txnSubtype === 'Add balance') {
    if (desc.includes('Bank transfer')) {
      channel = 'TikTok Top Up';
      campaign = 'Bank Transfer';
      if (spendDate >= '2026-05-01' && spendDate < '2026-06-01') {
        topUpMay += Math.abs(amount);
        topUpMayDetails.push({ date: spendDate, amount: Math.abs(amount), txnId, desc: desc.substring(0, 60) });
      }
    } else if (desc.includes('GMV Pay')) {
      // NOT top up — this is GMV payment settlement
      channel = 'TikTok Ads Settlement';
      campaign = 'GMV Auto';
      gmvTotal += Math.abs(amount);
    } else {
      // Other Add balance — not Bank transfer, not GMV Pay
      channel = 'TikTok Ads Settlement';
      campaign = 'Other';
    }
  } else if (txnType === 'General' && txnSubtype === 'Bill payment') {
    channel = 'TikTok Ads Settlement';
    campaign = 'GMV Auto';
    gmvTotal += Math.abs(amount);
  } else {
    channel = `TikTok ${txnType}`;
    campaign = txnSubtype;
  }

  if (!channel) continue;

  adStmt.run(STORE, spendDate, Math.abs(amount), channel, campaign,
    `Txn:${txnId} ${desc}`.substring(0, 200), now, now, txnId);
  totalInserted++;
}

console.log(`  Raw: ${adRows.length} rows, Success: ${totalSuccess}, Failed: ${totalFailed}`);
console.log(`  Inserted: ${totalInserted} unique Transaction IDs`);
console.log(`  May Top Up (Bank Transfer only): ${fmt(topUpMay)} (golden: Rp1.665.000) ${Math.abs(topUpMay - 1665000) <= 1 ? '✅ EXACT' : '❌ diff ' + (topUpMay - 1665000)}`);
console.log(`  GMV/Settlement total: ${fmt(gmvTotal)}`);

if (topUpMayDetails.length > 0) {
  console.log(`\n  Top Up May drilldown:`);
  for (const d of topUpMayDetails) {
    console.log(`    ${d.date}: ${fmt(d.amount)} — ${d.desc}`);
  }
}

// ═══════════════════════════════════════════
// #1: AUGUST DANA TERTAHAN FULL REFUND
// ═══════════════════════════════════════════
console.log('\n=== #1: AUGUST DANA TERTAHAN FULL REFUND ===');

// Check if order 585309498902545580 has completed returns
const fullRefundOrder = '585309498902545580';
const returns = db.prepare(`
  SELECT return_order_id, return_status, return_amount, quantity 
  FROM finance_returns WHERE store_name=? AND order_id=?
`).all(STORE, fullRefundOrder);

console.log(`  Order ${fullRefundOrder} returns:`);
let completedReturns = 0;
for (const r of returns) {
  console.log(`    ${r.return_order_id}: ${r.return_status}, amount=${fmt(r.return_amount)}, qty=${r.quantity}`);
  if (r.return_status === 'Completed') completedReturns++;
}

// Calculate seller sales for this order
const orderSales = db.prepare(`
  SELECT SUM(gross_product) as gross, SUM(seller_discount) as disc, SUM(quantity) as qty
  FROM finance_order_lines WHERE store_name=? AND order_id=?
`).get(STORE, fullRefundOrder);
const orderOmzet = Math.max(0, (orderSales.gross || 0) - (orderSales.disc || 0));
console.log(`  Seller sales: gross=${fmt(orderSales.gross)}, disc=${fmt(orderSales.disc)}, net=${fmt(orderOmzet)}`);

// ═══════════════════════════════════════════
// #2, #6, #7: COMPREHENSIVE CALCULATIONS
// ═══════════════════════════════════════════
console.log('\n=== #2,6,7: COMPREHENSIVE CALCULATIONS ===');

// Build income-matched order ID sets
const allIncomeOids = new Set();
const incOids = db.prepare("SELECT DISTINCT order_id FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan'").all(STORE);
for (const r of incOids) allIncomeOids.add(String(r.order_id || '').trim());

// Build return data
const returnsByOid = new Map();
const allReturns = db.prepare("SELECT * FROM finance_returns WHERE store_name=?").all(STORE);
for (const r of allReturns) {
  const oid = String(r.order_id || '').trim();
  if (!returnsByOid.has(oid)) returnsByOid.set(oid, []);
  returnsByOid.get(oid).push(r);
}

function getHpp(sku, variation) {
  const key = ct(sku);
  // Canonical
  const CANONICAL = { 'holologo9': 9000, 'gancifotonama': 2000, 'ganciksgn1': 1500, 'holo': 700 };
  if (CANONICAL[key] !== undefined) return CANONICAL[key];
  // DB lookup
  const cost = db.prepare("SELECT hpp_per_unit FROM finance_sku_costs WHERE store_name='global' AND upper(sku)=upper(?)").get(sku);
  if (cost && Number(cost.hpp_per_unit) > 0) return Number(cost.hpp_per_unit);
  // POLA variation-based
  if (key === 'pola') {
    const varTok = ct(variation || '');
    const pcsMatch = varTok.match(/(\d+)\s*pcs/);
    if (pcsMatch) {
      const pcs = parseInt(pcsMatch[1]);
      if (pcs <= 25) return 3000; if (pcs <= 50) return 6000;
      if (pcs <= 100) return 12000; if (pcs <= 125) return 15000;
      if (pcs <= 150) return 18000; if (pcs <= 200) return 24000;
    }
  }
  // POLA with SKU key variants in DB (Polaroid25, Polaroid50, etc.)
  const polaKey = 'polaroid' + (key.match(/(\d+)/) ? key.match(/(\d+)/)[1] : '');
  const polaCost = db.prepare("SELECT hpp_per_unit FROM finance_sku_costs WHERE store_name='global' AND upper(sku)=upper(?)").get(polaKey);
  if (polaCost && Number(polaCost.hpp_per_unit) > 0) return Number(polaCost.hpp_per_unit);
  return 0;
}

function isCancelValid(status, cancelReason, hasTracking) {
  if (ct(status) !== 'dibatalkan') return false;
  const cr = ct(cancelReason || '');
  return cr.includes('pengirimanpaketgagal') || cr.includes('pakethilang') || cr.includes('gagalkirim');
}

// Calculate for a month
function calcMonth(month) {
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const endDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const orders = db.prepare(`SELECT * FROM finance_order_lines WHERE store_name=? AND created_at>=? AND created_at<?`).all(STORE, startDate, endDate);

  const orderGroups = new Map();
  for (const o of orders) {
    const oid = String(o.order_id || '').trim();
    if (!orderGroups.has(oid)) orderGroups.set(oid, []);
    orderGroups.get(oid).push(o);
  }

  let hppSelesai = 0, hppDikirim = 0, hppCV = 0;
  const pkgSelesai = new Set(), pkgDikirim = new Set(), pkgCV = new Set();
  const statusCounts = { selesai: 0, dikirim: 0, dibatalkan: 0, perluDikirim: 0, belumBayar: 0, cancelValid: 0 };
  const completedReturnOids = new Set();
  const cancelOids = new Set();

  // Return cohorts by original order
  for (const [oid, rets] of returnsByOid) {
    if (!orderGroups.has(oid)) continue;
    const rows = orderGroups.get(oid);
    const created = rows[0].created_at || '';
    if (!created.startsWith(month)) continue;
    for (const r of rets) {
      if (r.return_status === 'Completed') completedReturnOids.add(oid);
    }
  }

  let dtRaw = 0, dtRawGross = 0, dtFullRefundExcluded = 0, dtNormalCount = 0, dtNormalGross = 0;
  let returnRiskCount = 0, returnRiskGross = 0;

  for (const [oid, rows] of orderGroups) {
    const st = ct(rows[0].status);
    const cr = rows[0].cancel_reason || '';
    const hasTracking = rows.some(r => String(r.tracking_id || '').trim() || String(r.shipped_time || '').trim());

    if (st.includes('selesai')) statusCounts.selesai++;
    else if (st === 'dikirim' || (st.includes('dikirim') && !st.includes('perlu'))) statusCounts.dikirim++;
    else if (st.includes('dibatalkan')) {
   statusCounts.dibatalkan++;
   cancelOids.add(oid);
   if (isCancelValid(rows[0].status, cr, hasTracking)) statusCounts.cancelValid++;
 }
    else if (st.includes('perludikirim')) statusCounts.perluDikirim++;
    else if (st.includes('belumbayar') || st.includes('unpaid')) statusCounts.belumBayar++;

    if (st.includes('dibatalkan')) cancelOids.add(oid);

    // HPP & Packing — per-order
    const isCV = isCancelValid(rows[0].status, cr, hasTracking);
    for (const r of rows) {
      const hpp = getHpp(r.sku, r.variation);
      const qty = Number(r.quantity || 0);
      const pk = String(r.tracking_id || r.package_id || r.order_id || '').trim();
      if (st.includes('selesai')) { hppSelesai += qty * hpp; if (pk) pkgSelesai.add(pk); }
      else if (st === 'dikirim' || (st.includes('dikirim') && !st.includes('perlu'))) { hppDikirim += qty * hpp; if (pk) pkgDikirim.add(pk); }
      if (isCV && cancelOids.has(oid)) { hppCV += qty * hpp; if (pk) pkgCV.add(pk); }
    }

    // Dana Tertahan
    const isDikirim = st === 'dikirim' || (st.includes('dikirim') && !st.includes('perlu'));
    const isSelesai = st.includes('selesai');
    if (!isDikirim && !isSelesai) continue;
    if (allIncomeOids.has(oid)) continue;

    let orderOmzet = 0;
    for (const r of rows) orderOmzet += Math.abs(Number(r.gross_product || 0)) - Math.abs(Number(r.seller_discount || 0));
    orderOmzet = Math.max(0, orderOmzet);

    dtRaw++;
    dtRawGross += orderOmzet;

    // Check full refund
    const rets = returnsByOid.get(oid) || [];
    const completedRets = rets.filter(r => r.return_status === 'Completed');
    const activeRets = rets.filter(r => r.return_status === 'To Process' || r.return_status === 'In Process');

    // Full return check: all order quantity returned and completed
    const orderQty = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    let returnedQty = 0;
    for (const r of completedRets) returnedQty += Number(r.quantity || 0);

    if (completedRets.length > 0 && returnedQty >= orderQty) {
      dtFullRefundExcluded++;
    } else {
      dtNormalCount++;
      dtNormalGross += orderOmzet;
      if (activeRets.length > 0) {
        returnRiskCount++;
        returnRiskGross += orderOmzet;
      }
    }
  }

  return {
    statusCounts,
    hpp: { selesai: hppSelesai, dikirim: hppDikirim, cv: hppCV, total: hppSelesai + hppDikirim + hppCV },
    packing: {
      selesai: pkgSelesai.size * 2000, dikirim: pkgDikirim.size * 2000, cv: pkgCV.size * 2000,
      total: (pkgSelesai.size + pkgDikirim.size + pkgCV.size) * 2000,
      pkgSelesai: pkgSelesai.size, pkgDikirim: pkgDikirim.size, pkgCV: pkgCV.size,
    },
    danaTertahan: {
      rawCandidateCount: dtRaw, rawGross: dtRawGross,
      fullRefundExcluded: dtFullRefundExcluded,
      normalCount: dtNormalCount, normalGross: dtNormalGross,
      returnRiskCount, returnRiskGross,
    },
    returCancel: {
      completedReturnUniqueOrders: completedReturnOids.size,
      cancelOrders: cancelOids.size,
      total: completedReturnOids.size + cancelOids.size,
    },
  };
}

// July
const jul = calcMonth('2026-07');
console.log('\n--- JULI ---');
console.log(`  HPP Selesai: ${fmt(jul.hpp.selesai)} (expected Rp22.959.000) ${Math.abs(jul.hpp.selesai - 22959000) <= 1 ? '✅' : '❌'}`);
console.log(`  HPP Dikirim: ${fmt(jul.hpp.dikirim)} (expected Rp1.156.500) ${Math.abs(jul.hpp.dikirim - 1156500) <= 1 ? '✅' : '❌'}`);
console.log(`  HPP CV: ${fmt(jul.hpp.cv)} (expected Rp622.200) ${Math.abs(jul.hpp.cv - 622200) <= 1 ? '✅' : '❌'}`);
console.log(`  HPP Accrual: ${fmt(jul.hpp.total)} (expected Rp24.737.700) ${Math.abs(jul.hpp.total - 24737700) <= 1 ? '✅' : '❌'}`);
console.log(`  Packing Selesai: ${jul.packing.pkgSelesai} pkt = ${fmt(jul.packing.selesai)} (expected Rp12.390.000) ${Math.abs(jul.packing.selesai - 12390000) <= 1 ? '✅' : '❌'}`);
console.log(`  Packing Dikirim: ${jul.packing.pkgDikirim} pkt = ${fmt(jul.packing.dikirim)} (expected Rp758.000) ${Math.abs(jul.packing.dikirim - 758000) <= 1 ? '✅' : '❌'}`);
console.log(`  Packing CV: ${jul.packing.pkgCV} pkt = ${fmt(jul.packing.cv)} (expected Rp254.000) ${Math.abs(jul.packing.cv - 254000) <= 1 ? '✅' : '❌'}`);
console.log(`  Packing Accrual: ${fmt(jul.packing.total)} (expected Rp13.402.000) ${Math.abs(jul.packing.total - 13402000) <= 1 ? '✅' : '❌'}`);

console.log(`\n  Dana Tertahan:`);
console.log(`    Raw: ${jul.danaTertahan.rawCandidateCount} order, ${fmt(jul.danaTertahan.rawGross)}`);
console.log(`    Full-Refund Excluded: ${jul.danaTertahan.fullRefundExcluded}`);
console.log(`    Normal: ${jul.danaTertahan.normalCount} order, ${fmt(jul.danaTertahan.normalGross)}`);
console.log(`    Return-Risk: ${jul.danaTertahan.returnRiskCount} order, ${fmt(jul.danaTertahan.returnRiskGross)}`);

console.log(`\n  Paket Retur/Cancel:`);
console.log(`    Completed Return unique orders: ${jul.returCancel.completedReturnUniqueOrders}`);
console.log(`    Cancel orders: ${jul.returCancel.cancelOrders}`);
console.log(`    Total: ${jul.returCancel.total} (expected 1,938) ${jul.returCancel.total === 1938 ? '✅' : '❌'}`);

// August
const aug = calcMonth('2026-08');
console.log('\n--- AGUSTUS ---');
console.log(`  Dana Tertahan:`);
console.log(`    Raw: ${aug.danaTertahan.rawCandidateCount} order, ${fmt(aug.danaTertahan.rawGross)}`);
console.log(`    Full-Refund Excluded: ${aug.danaTertahan.fullRefundExcluded}`);
console.log(`    Normal: ${aug.danaTertahan.normalCount} order, ${fmt(aug.danaTertahan.normalGross)}`);
console.log(`    Return-Risk: ${aug.danaTertahan.returnRiskCount} order, ${fmt(aug.danaTertahan.returnRiskGross)}`);
console.log(`    Expected: 654 order, Rp14.550.013`);
console.log(`    Normal match: ${aug.danaTertahan.normalCount === 654 && Math.abs(aug.danaTertahan.normalGross - 14550013) <= 1 ? '✅' : '❌'}`);

console.log(`\n  Paket Retur/Cancel:`);
console.log(`    Completed Return unique orders: ${aug.returCancel.completedReturnUniqueOrders}`);
console.log(`    Cancel orders: ${aug.returCancel.cancelOrders}`);
console.log(`    Total: ${aug.returCancel.total} (expected 148) ${aug.returCancel.total === 148 ? '✅' : '❌'}`);

// ═══════════════════════════════════════════
// #8: UPSERT TEST
// ═══════════════════════════════════════════
console.log('\n=== #8: UPSERT TEST ===');

// Test A: Order status update
const testOid = 'TEST_UPSERT_001';
const testSku = 'TESTSKU';
const testKey = `custombase|${testOid}|${testSku.toLowerCase()}|`;

// Insert as Dikirim
db.prepare(`INSERT OR REPLACE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,quantity,gross_product,seller_discount,order_amount,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  testKey, testOid, STORE, 'test', '2026-08-01', '2026-08-01', 'Dikirim', testSku, 1, 50000, 0, 50000, 'test.js', now
);

let orderCheck = db.prepare("SELECT status FROM finance_order_lines WHERE line_key=?").get(testKey);
console.log(`  Test A: Insert Dikirim → status=${orderCheck.status} ${orderCheck.status === 'Dikirim' ? '✅' : '❌'}`);

// Update to Selesai
db.prepare(`INSERT OR REPLACE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,sku,quantity,gross_product,seller_discount,order_amount,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  testKey, testOid, STORE, 'test', '2026-08-01', '2026-08-02', 'Selesai', testSku, 1, 50000, 0, 50000, 'test.js', now
);

orderCheck = db.prepare("SELECT status FROM finance_order_lines WHERE line_key=?").get(testKey);
const countCheck = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE order_id=?").get(testOid);
console.log(`  Test A: Update ke Selesai → status=${orderCheck.status} ${orderCheck.status === 'Selesai' ? '✅' : '❌'}`);
console.log(`  Test A: Only 1 row → count=${countCheck.c} ${countCheck.c === 1 ? '✅ (no duplicate)' : '❌ DUPLICATE!'}`);

// Test B: Return status update
const testRetOid = 'TEST_RETURN_001';
db.prepare(`INSERT OR REPLACE INTO finance_returns(return_order_id,order_id,store_name,return_status,return_type,imported_at) VALUES(?,?,?,?,?,?)`).run(
  testRetOid, 'TEST_ORDER_001', STORE, 'To Process', 'Return and refund', now
);

let retCheck = db.prepare("SELECT return_status FROM finance_returns WHERE store_name=? AND return_order_id=?").get(STORE, testRetOid);
console.log(`  Test B: Insert To Process → ${retCheck.return_status} ${retCheck.return_status === 'To Process' ? '✅' : '❌'}`);

db.prepare(`INSERT OR REPLACE INTO finance_returns(return_order_id,order_id,store_name,return_status,return_type,imported_at) VALUES(?,?,?,?,?,?)`).run(
  testRetOid, 'TEST_ORDER_001', STORE, 'Completed', 'Return and refund', now
);

retCheck = db.prepare("SELECT return_status FROM finance_returns WHERE store_name=? AND return_order_id=?").get(STORE, testRetOid);
const retCount = db.prepare("SELECT COUNT(*) as c FROM finance_returns WHERE return_order_id=?").get(testRetOid);
console.log(`  Test B: Update ke Completed → ${retCheck.return_status} ${retCheck.return_status === 'Completed' ? '✅' : '❌'}`);
console.log(`  Test B: Only 1 row → count=${retCount.c} ${retCount.c === 1 ? '✅ (no duplicate)' : '❌ DUPLICATE!'}`);

// Clean up test data
db.prepare("DELETE FROM finance_order_lines WHERE order_id LIKE 'TEST_UPSERT_%'").run();
db.prepare("DELETE FROM finance_returns WHERE return_order_id LIKE 'TEST_RETURN_%'").run();

// ═══════════════════════════════════════════
// ADS FILE STATUS
// ═══════════════════════════════════════════
console.log('\n=== #3: ADS FILE STATUS ===');
const adFile2 = path.join(DATA_DIR, 'iklan 1juli-sekarang.xlsx');
console.log(`  File Mei-Juni: ✅ TERSEDIA (208 raw, ${totalSuccess} Success, ${totalFailed} Failed)`);
console.log(`  File Juli-Agustus: ${fs.existsSync(adFile2) ? '✅ TERSEDIA' : '❌ TIDAK TERSEDIA'}`);
if (!fs.existsSync(adFile2)) {
  console.log(`  ADS_FILE_JULI_AGUSTUS_TIDAK_TERSEDIA`);
}
console.log(`  finance_ad_spend total: ${totalInserted} unique Transaction IDs`);

// ═══════════════════════════════════════════
// FINAL STATUS
// ═══════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════╗');
console.log('║  FINAL ACCEPTANCE STATUS                 ║');
console.log('╚══════════════════════════════════════════╝');

const checks = [
  ['Iklan Top Up May', Math.abs(topUpMay - 1665000) <= 1],
  ['July HPP Selesai', Math.abs(jul.hpp.selesai - 22959000) <= 1],
  ['July HPP Dikirim', Math.abs(jul.hpp.dikirim - 1156500) <= 1],
  ['July HPP CV', Math.abs(jul.hpp.cv - 622200) <= 1],
  ['July Packing Selesai', Math.abs(jul.packing.selesai - 12390000) <= 1],
  ['July Packing Dikirim', Math.abs(jul.packing.dikirim - 758000) <= 1],
  ['July Packing CV', Math.abs(jul.packing.cv - 254000) <= 1],
  ['July Dana Tertahan Normal', jul.danaTertahan.normalCount === 115 && Math.abs(jul.danaTertahan.normalGross - 3097889) <= 1],
  ['July Return-Risk Count', jul.danaTertahan.returnRiskCount === 4],
  ['Aug Dana Tertahan Normal', aug.danaTertahan.normalCount === 654 && Math.abs(aug.danaTertahan.normalGross - 14550013) <= 1],
  ['Aug Return-Risk Count', aug.danaTertahan.returnRiskCount === 3],
  ['July Retur/Cancel', jul.returCancel.total === 1938],
  ['Aug Retur/Cancel', aug.returCancel.total === 148],
  ['UPSERT order update', orderCheck && orderCheck.status === 'Selesai'],
  ['UPSERT return update', retCheck && retCheck.return_status === 'Completed'],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${name}`);
  if (ok) passed++;
}
console.log(`\n  ${passed}/${checks.length} acceptance checks passed`);

if (passed === checks.length) {
  console.log('\n  🎉 SEMUA ACCEPTANCE TERPENUHI — SIAP VALIDASI FINAL');
} else {
  console.log(`\n  ⚠ ${checks.length - passed} acceptance issues remaining`);
}

// Clean test data
try { db.prepare("DELETE FROM finance_order_lines WHERE order_id LIKE 'TEST_UPSERT_%'").run(); } catch(e) {}
try { db.prepare("DELETE FROM finance_returns WHERE return_order_id LIKE 'TEST_RETURN_%'").run(); } catch(e) {}

db.close();
