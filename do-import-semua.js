/**
 * Import file pesanan dan cair lewat pipeline resmi finance-cloud.js
 * Tujuan: 18 order masuk DB + data cair/withdrawal ter-proses
 */
const { importRows } = require('./lib/finance-cloud');
const XLSX = require('xlsx');
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const sep = () => console.log('-'.repeat(60));

async function readExcelRows(filename) {
    const f = XLSX.readFile(filename);
    const ws = f.Sheets[f.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

async function main() {
    // 1. Import file pesanan Juli (tambah 18 order yang missing)
    console.log('\n=== STEP 1: IMPORT FILE PESANAN JULI ===');
    sep();
    const orderRows = await readExcelRows('juli custombase.xlsx');
    console.log('Total baris di file:', orderRows.length);
    try {
        const result = await importRows({
            storeName: 'custombase',
            kind: 'orders',
            filename: 'juli custombase.xlsx',
            rows: orderRows,
        });
        console.log('✅ Hasil import pesanan:', JSON.stringify(result));
    } catch (e) {
        console.log('❌ Error import pesanan:', e.message);
    }

    // 2. Import file cair (settlement / penarikan)
    console.log('\n=== STEP 2: IMPORT FILE CAIR JULI ===');
    sep();
    const cairFile = XLSX.readFile('cair juli custombase.xlsx');
    console.log('Sheets:', cairFile.SheetNames.join(', '));

    // Coba import sheet "Detail pesanan" sebagai income
    const cairRows = XLSX.utils.sheet_to_json(cairFile.Sheets[cairFile.SheetNames[0]], { defval: '' });
    console.log('Baris di "Detail pesanan":', cairRows.length);
    console.log('Kolom:', Object.keys(cairRows[0] || {}).slice(0, 5).join(' | '));

    try {
        const result = await importRows({
            storeName: 'custombase',
            kind: 'income',
            filename: 'cair juli custombase.xlsx',
            rows: cairRows,
        });
        console.log('✅ Hasil import cair:', JSON.stringify(result));
    } catch (e) {
        console.log('⚠️  Auto-detect income gagal:', e.message);
        // Coba detect sebagai auto
        try {
            const result2 = await importRows({
                storeName: 'custombase',
                kind: 'auto',
                filename: 'cair juli custombase.xlsx',
                rows: cairRows,
            });
            console.log('✅ Hasil import (auto):', JSON.stringify(result2));
        } catch (e2) {
            console.log('❌ Error:', e2.message.slice(0, 200));
        }
    }

    // 3. Verifikasi hasil
    const db = require('./lib/pg-connector').getDb();
    const statusAll = db.prepare(`SELECT status, COUNT(DISTINCT order_id) as cnt FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%' GROUP BY status ORDER BY cnt DESC`).all();
    console.log('\n=== VERIFIKASI DB SETELAH IMPORT ===');
    sep();
    statusAll.forEach(r => console.log(' ', r.status, ':', r.cnt, 'order'));

    const incomeCheck = db.prepare(`SELECT COUNT(DISTINCT order_id) as unique_ids, SUM(settlement_amount) as total FROM finance_income_raw WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'`).get();
    console.log('Income records Juli:', incomeCheck.unique_ids, 'order =', rp(incomeCheck.total));
}

main().catch(e => console.error('Fatal:', e.message));
