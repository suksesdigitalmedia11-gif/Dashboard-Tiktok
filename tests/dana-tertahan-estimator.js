/**
 * DANA TERTAHAN FEE ESTIMATOR — Full Audit Trail
 * Produces all required fields for release gate
 */
const db = require('better-sqlite3')('./data/finance.db');
const fmt = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const pct = n => (n * 100).toFixed(2) + '%';
const ct = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const STORE = 'custombase';

function estimateDanaTertahan(month, grossOutstanding, candidateOidsSet) {
  const [y, m] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;

  // Training data: Pesanan rows with Total Pendapatan > 0 in the same month
  const training = db.prepare(`
    SELECT SUM(total_fees) as signedFee, SUM(total_revenue) as revenue, COUNT(*) as sample
    FROM finance_income_raw 
    WHERE store_name=? AND transaction_type='Pesanan' 
    AND total_revenue > 0
    AND total_revenue IS NOT NULL AND total_revenue != ''
    AND order_created_time >= ? AND order_created_time < ?
  `).get(STORE, startDate, endDate);

  const signedFee = training.signedFee || 0;
  const revenue = training.revenue || 0;
  const sampleCount = training.sample || 0;
  const feeRate = revenue > 0 ? Math.abs(signedFee) / revenue : 0;

  // Known refund + partial settlement for CANDIDATE orders only
  let knownRefund = 0, actualPartialSettlement = 0;
  if (candidateOidsSet && candidateOidsSet.size > 0) {
    // Build IN clause for candidate orders
    const placeholders = [...candidateOidsSet].map(() => '?').join(',');
    const refunds = db.prepare(`
      SELECT SUM(refund_amount) as r, SUM(CASE WHEN settlement_amount > 0 THEN settlement_amount ELSE 0 END) as s
      FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan'
      AND order_id IN (${placeholders})
    `).get(STORE, ...candidateOidsSet);
    knownRefund = Math.abs(refunds.r || 0);
    actualPartialSettlement = Math.max(0, refunds.s || 0);
  }

  // Estimated platform fee on outstanding
  const estimatedPlatformFee = Math.round(grossOutstanding * feeRate);

  // Net outstanding
  const estimatedNetOutstanding = Math.max(0,
    grossOutstanding - knownRefund - estimatedPlatformFee - actualPartialSettlement
  );

  return {
    grossOutstanding,
    estimatedPlatformFee,
    estimatedFeeRate: feeRate,
    estimationMethod: 'store_weighted_rate',
    sampleCount,
    trainingRevenue: Math.round(revenue),
    trainingSignedFee: Math.round(Math.abs(signedFee)),
    basisStartDate: startDate,
    basisEndDate: endDate,
    calculatedAsOf: new Date().toISOString().slice(0, 10),
    knownRefund,
    actualPartialSettlement,
    estimatedNetOutstanding,
    // Proof
    formulaProof: `net = gross(${grossOutstanding}) - knownRefund(${knownRefund}) - estimatedFee(${estimatedPlatformFee}) - partialSettlement(${actualPartialSettlement}) = ${estimatedNetOutstanding}`,
    roundingRule: 'Round half-up to nearest Rupiah (Math.round)',
  };
}

// ═══════════════════════════════════
console.log('╔══════════════════════════════════════════════╗');
console.log('║  DANA TERTAHAN FEE ESTIMATOR — AUDIT TRAIL   ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Build income-matched set
const incomeOids = new Set();
const inc = db.prepare("SELECT DISTINCT order_id FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan'").all(STORE);
for (const r of inc) incomeOids.add(String(r.order_id || '').trim());

// Build return map
const returnMap = new Map();
const rets = db.prepare("SELECT * FROM finance_returns WHERE store_name=?").all(STORE);
for (const r of rets) {
  const oid = String(r.order_id || '').trim();
  if (!returnMap.has(oid)) returnMap.set(oid, []);
  returnMap.get(oid).push(r);
}

function calcDT(month) {
  const [y, m] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const orders = db.prepare("SELECT * FROM finance_order_lines WHERE store_name=? AND created_at>=? AND created_at<?").all(STORE, startDate, endDate);
  const groups = new Map();
  for (const o of orders) {
    const oid = String(o.order_id || '').trim();
    if (!groups.has(oid)) groups.set(oid, []);
    groups.get(oid).push(o);
  }

  let rawCount = 0, rawGross = 0, fullRefundExcluded = 0;
  let normalCount = 0, normalGross = 0, returnRiskCount = 0, returnRiskGross = 0;
  const candidateOids = new Set();

  for (const [oid, rows] of groups) {
    const st = ct(rows[0].status);
    if ((!st.includes('dikirim') && !st.includes('selesai')) || st.includes('perlu')) continue;
    if (incomeOids.has(oid)) continue;

    let omzet = 0;
    for (const r of rows) omzet += Math.abs(Number(r.gross_product || 0)) - Math.abs(Number(r.seller_discount || 0));
    omzet = Math.max(0, omzet);

    rawCount++;
    rawGross += omzet;
    candidateOids.add(oid);

    const orets = returnMap.get(oid) || [];
    const completedRets = orets.filter(r => r.return_status === 'Completed');
    const activeRets = orets.filter(r => r.return_status === 'To Process' || r.return_status === 'In Process');
    const orderQty = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    let retQty = 0;
    for (const r of completedRets) retQty += Number(r.quantity || 0);

    if (completedRets.length > 0 && retQty >= orderQty) {
      fullRefundExcluded++;
    } else {
      normalCount++;
      normalGross += omzet;
      if (activeRets.length > 0) {
        returnRiskCount++;
        returnRiskGross += omzet;
      }
    }
  }

  const estimate = estimateDanaTertahan(month, normalGross, candidateOids);

  return {
    month,
    rawCandidateCount: rawCount,
    rawGross,
    fullRefundExcludedCount: fullRefundExcluded,
    normalCandidateCount: normalCount,
    normalGross,
    returnRiskCount,
    returnRiskGross,
    estimate,
  };
}

// === JULI ===
const jul = calcDT('2026-07');
console.log('=== JULI 2026 DANA TERTAHAN ===');
console.log(`  grossOutstanding:           ${fmt(jul.normalGross)}`);
console.log(`  candidateOrderCount:        ${jul.normalCandidateCount} (${jul.rawCandidateCount} raw - ${jul.fullRefundExcludedCount} full refund)`);
console.log(`  returnRiskOrderCount:       ${jul.returnRiskCount}`);
console.log(`  returnRiskGross:            ${fmt(jul.returnRiskGross)}`);
console.log(`  --- Estimator ---`);
console.log(`  estimationMethod:           ${jul.estimate.estimationMethod}`);
console.log(`  sampleCount:                ${jul.estimate.sampleCount} Pesanan rows (Total Pendapatan > 0)`);
console.log(`  trainingRevenue:            ${fmt(jul.estimate.trainingRevenue)}`);
console.log(`  trainingSignedFee:          ${fmt(jul.estimate.trainingSignedFee)}`);
console.log(`  estimatedFeeRate:           ${pct(jul.estimate.estimatedFeeRate)}`);
console.log(`  basisPeriod:                ${jul.estimate.basisStartDate} s/d ${jul.estimate.basisEndDate}`);
console.log(`  calculatedAsOf:             ${jul.estimate.calculatedAsOf}`);
console.log(`  --- Net ---`);
console.log(`  estimatedPlatformFee:       ${fmt(jul.estimate.estimatedPlatformFee)}`);
console.log(`  knownRefund:                ${fmt(jul.estimate.knownRefund)}`);
console.log(`  actualPartialSettlement:    ${fmt(jul.estimate.actualPartialSettlement)}`);
console.log(`  estimatedNetOutstanding:    ${fmt(jul.estimate.estimatedNetOutstanding)}`);
console.log(`  rounding:                   ${jul.estimate.roundingRule}`);
console.log(`  proof:                      ${jul.estimate.formulaProof}`);
console.log(`  status:                     ESTIMASI`);

// === AGUSTUS ===
const aug = calcDT('2026-08');
console.log('\n=== AGUSTUS 1-7 2026 DANA TERTAHAN ===');
console.log(`  grossOutstanding:           ${fmt(aug.normalGross)}`);
console.log(`  candidateOrderCount:        ${aug.normalCandidateCount} (${aug.rawCandidateCount} raw - ${aug.fullRefundExcludedCount} full refund)`);
console.log(`  returnRiskOrderCount:       ${aug.returnRiskCount}`);
console.log(`  returnRiskGross:            ${fmt(aug.returnRiskGross)}`);
console.log(`  --- Estimator ---`);
console.log(`  estimationMethod:           ${aug.estimate.estimationMethod}`);
console.log(`  sampleCount:                ${aug.estimate.sampleCount} Pesanan rows (Total Pendapatan > 0)`);
console.log(`  trainingRevenue:            ${fmt(aug.estimate.trainingRevenue)}`);
console.log(`  trainingSignedFee:          ${fmt(aug.estimate.trainingSignedFee)}`);
console.log(`  estimatedFeeRate:           ${pct(aug.estimate.estimatedFeeRate)}`);
console.log(`  basisPeriod:                ${aug.estimate.basisStartDate} s/d ${aug.estimate.basisEndDate}`);
console.log(`  calculatedAsOf:             ${aug.estimate.calculatedAsOf}`);
console.log(`  --- Net ---`);
console.log(`  estimatedPlatformFee:       ${fmt(aug.estimate.estimatedPlatformFee)}`);
console.log(`  knownRefund:                ${fmt(aug.estimate.knownRefund)}`);
console.log(`  actualPartialSettlement:    ${fmt(aug.estimate.actualPartialSettlement)}`);
console.log(`  estimatedNetOutstanding:    ${fmt(aug.estimate.estimatedNetOutstanding)}`);
console.log(`  rounding:                   ${aug.estimate.roundingRule}`);
console.log(`  proof:                      ${aug.estimate.formulaProof}`);
console.log(`  status:                     ESTIMASI`);

// === FINAL STATUS ===
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║  RELEASE GATE STATUS                         ║');
console.log('╚══════════════════════════════════════════════╝');

// Check ads completeness
const adCount = db.prepare("SELECT COUNT(DISTINCT transaction_id) as c FROM finance_ad_spend WHERE store_name=?").get(STORE).c;
const adsComplete = adCount >= 462;
console.log(`  Ads: ${adCount} unique Transaction IDs ${adsComplete ? '✅ LENGKAP' : '⚠ DATA IKLAN TIDAK LENGKAP (hanya file Mei-Juni)'}`);

console.log(`  Golden Mei: FIXTURE_GOLDEN_MEI_TIDAK_LENGKAP (SKIPPED)`);
console.log(`  July Dana Tertahan: ESTIMASI`);
console.log(`  August Dana Tertahan: ESTIMASI`);
console.log(`  July Status: ${adsComplete ? 'BELUM FINAL (379 Dikirim)' : 'DATA IKLAN TIDAK LENGKAP'}`);
console.log(`  August Status: ${adsComplete ? 'BULAN BERJALAN / ESTIMASI' : 'DATA IKLAN TIDAK LENGKAP'}`);

if (adsComplete) {
  console.log(`\n  ✅ SIAP VALIDASI FINAL`);
  console.log(`  ⚠ SIAP PRODUKSI FINAL — MENUNGGU GOLDEN MEI FIXTURE`);
} else {
  console.log(`\n  ⚠ BELUM SIAP PRODUKSI FINAL`);
  console.log(`  Menunggu: file iklan 1juli-sekarang.xlsx + Golden Mei fixture`);
}

db.close();
