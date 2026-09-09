/**
 * Import Iklan GMV dari file Excel ke DB
 * File: iklan juli custombase.xlsx
 * Target: finance_ad_spend tabel
 * 
 * Format file: Transaction time | Transaction type | Transaction subtype | Amount | ...
 */
const db = require('./lib/pg-connector').getDb();
const XLSX = require('xlsx');
const path = require('path');

const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

console.log('[import-iklan-gmv] Membaca file iklan juli custombase.xlsx...');
const iklanFile = XLSX.readFile('iklan juli custombase.xlsx');
const ws = iklanFile.Sheets[iklanFile.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log(`Total baris: ${rows.length}`);
console.log('Kolom:', Object.keys(rows[0] || {}).join(' | '));
console.log('Sample row 1:', JSON.stringify(rows[0]).slice(0, 200));

// Parse amount - cek format
const parseAmount = (val) => {
    if (!val) return 0;
    const str = String(val).replace(/[^0-9.-]/g, '');
    return parseFloat(str) || 0;
};

const parseDate = (val) => {
    if (!val) return null;
    // Format: "2026/07/31 09:52" atau "2026-07-31"
    const str = String(val).trim();
    // Ambil tanggal saja (YYYY-MM-DD)
    const match = str.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    return null;
};

// Hitung total dulu
let totalAmount = 0;
rows.forEach(r => { totalAmount += Math.abs(parseAmount(r['Amount'])); });
console.log(`\nTotal amount di file: ${rp(totalAmount)}`);

// Cek yang sudah ada di DB
const existing = db.prepare(`
  SELECT transaction_id, amount, spend_date FROM finance_ad_spend 
  WHERE store_name='custombase' AND spend_date LIKE '2026-07%'
`).all();
const existingIds = new Set(existing.map(r => String(r.transaction_id || '')));
console.log(`Sudah ada di DB: ${existing.length} entri (total: ${rp(existing.reduce((s, r) => s + r.amount, 0))})`);

// Siapkan data baru yang belum ada di DB
const toInsert = [];
let skipped = 0;
rows.forEach((r, idx) => {
    const txId = String(r['Transaction ID'] || '').trim();
    const amount = Math.abs(parseAmount(r['Amount']));
    const date = parseDate(r['Transaction time']);
    const txType = String(r['Transaction type'] || '').trim();
    const txSubtype = String(r['Transaction subtype'] || '').trim();
    const status = String(r['Status'] || '').trim();

    if (!date || amount <= 0) {
        skipped++;
        return;
    }

    if (txId && existingIds.has(txId)) {
        // sudah ada, skip
        return;
    }

    toInsert.push({
        store_name: 'custombase',
        spend_date: date,
        amount: amount,
        channel: 'TikTok GMV Ads',
        campaign: txSubtype || txType || 'GMV Ads',
        note: `Imported from iklan juli custombase.xlsx | ${txType} - ${txSubtype}`,
        transaction_id: txId || `gmv_${date}_${idx}`,
        status: status || 'completed',
    });
});

console.log(`\nSiap insert: ${toInsert.length} entri baru`);
console.log(`Dilewati (tanpa tanggal/amount): ${skipped}`);
if (toInsert.length > 0) {
    console.log(`Total yang akan ditambahkan: ${rp(toInsert.reduce((s, r) => s + r.amount, 0))}`);
}

if (toInsert.length === 0) {
    console.log('\n⚠️  Tidak ada data baru untuk diinsert.');
    console.log('   Kemungkinan semua sudah ada di DB, atau format file berbeda dari yang diharapkan.');
    process.exit(0);
}

// Preview 5 pertama
console.log('\nPreview data yang akan diinsert:');
toInsert.slice(0, 5).forEach(r => {
    console.log(`  ${r.spend_date} | ${rp(r.amount)} | ${r.campaign} | txId: ${r.transaction_id.slice(-12)}`);
});

// DRY RUN dulu
const args = process.argv.slice(2);
if (!args.includes('--execute')) {
    console.log('\n[DRY RUN] Jalankan dengan --execute untuk benar-benar insert ke DB:');
    console.log('  node import-iklan-gmv-juli.js --execute');
    process.exit(0);
}

// EXECUTE
const insert = db.prepare(`
  INSERT OR REPLACE INTO finance_ad_spend 
    (store_name, spend_date, amount, channel, campaign, note, transaction_id, status, created_at, updated_at)
  VALUES 
    (@store_name, @spend_date, @amount, @channel, @campaign, @note, @transaction_id, @status, datetime('now'), datetime('now'))
`);

const insertMany = db.transaction((items) => {
    for (const item of items) insert.run(item);
});

insertMany(toInsert);
console.log(`\n✅ Berhasil insert ${toInsert.length} entri iklan GMV ke DB`);

// Verifikasi
const after = db.prepare(`
  SELECT COUNT(*) as cnt, SUM(amount) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'
`).get();
console.log(`Total di DB setelah import: ${after.cnt} entri = ${rp(after.total)}`);
