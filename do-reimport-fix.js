/**
 * Re-import semua data custombase Juli:
 * 1. Update existing Issued entries di DB jadi negatif (kredit)
 * 2. Re-import file iklan dengan logika baru (Issued = negatif)
 * 3. Re-import file pesanan dengan fallback ke Platform SKU ID
 * 4. Verifikasi hasil
 */
const { importRows } = require('./lib/finance-cloud');
const db = require('./lib/pg-connector').getDb();
const XLSX = require('xlsx');
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const sep = () => console.log('-'.repeat(60));

async function main() {
    // === STEP 1: Hapus semua iklan lama Juli custombase, re-import dengan logika baru ===
    console.log('\n=== STEP 1: RESET & RE-IMPORT IKLAN GMV ===');
    sep();

    const delIklan = db.prepare("DELETE FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'");
    const r1 = delIklan.run();
    console.log('Hapus iklan lama:', r1.changes, 'entri');

    const iklanFile = XLSX.readFile('iklan juli custombase.xlsx');
    const iklanRows = XLSX.utils.sheet_to_json(iklanFile.Sheets[iklanFile.SheetNames[0]], { defval: '' });
    console.log('File iklan baris:', iklanRows.length);

    try {
        const res = await importRows({
            storeName: 'custombase',
            kind: 'ads',
            filename: 'iklan juli custombase.xlsx',
            rows: iklanRows,
        });
        console.log('✅ Import iklan selesai:', JSON.stringify(res));
    } catch (e) {
        console.log('❌ Error iklan:', e.message);
    }

    // Verifikasi iklan
    const vIklan = db.prepare("SELECT channel, campaign, COUNT(*) as cnt, SUM(amount) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%' GROUP BY channel, campaign").all();
    console.log('\nIklan di DB setelah re-import:');
    vIklan.forEach(r => console.log(' ', r.channel, '|', r.campaign, '|', r.cnt, 'baris |', rp(r.total)));
    const totalIklan = db.prepare("SELECT SUM(amount) as t, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as gross, SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as kredit FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'").get();
    console.log('Summary: Gross spend:', rp(totalIklan.gross), '| Kredit:', rp(totalIklan.kredit), '| NET:', rp(totalIklan.t));

    // === STEP 2: Re-import file pesanan (sekarang fallback ke Platform SKU ID) ===
    console.log('\n\n=== STEP 2: RE-IMPORT FILE PESANAN ===');
    sep();

    const orderFile = XLSX.readFile('juli custombase.xlsx');
    const orderRows = XLSX.utils.sheet_to_json(orderFile.Sheets[orderFile.SheetNames[0]], { defval: '' });
    console.log('File pesanan baris:', orderRows.length);

    try {
        const res = await importRows({
            storeName: 'custombase',
            kind: 'orders',
            filename: 'juli custombase.xlsx',
            rows: orderRows,
        });
        console.log('✅ Import pesanan selesai:', JSON.stringify(res));
    } catch (e) {
        console.log('❌ Error pesanan:', e.message);
    }

    // === VERIFIKASI FINAL ===
    console.log('\n\n=== VERIFIKASI FINAL ===');
    sep();

    const statusAll = db.prepare("SELECT status, COUNT(DISTINCT order_id) as cnt FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%' GROUP BY status ORDER BY cnt DESC").all();
    console.log('Status order di DB:');
    statusAll.forEach(r => console.log(' ', r.status, ':', r.cnt, 'order'));

    // Cek 18 order yang seharusnya sekarang ada
    const missing18 = ['584991320666834104', '584994661853267217', '585002685903111449', '585003685460936244',
        '585006789277222575', '585007536557622489', '585008043440965448', '585008600387913237',
        '585008616217216418', '585008729063458059', '585008790222374838', '585010522862290430',
        '585010782132274907', '585010874925418348', '585013710179304999', '585014107032093739',
        '585014746022642854', '585014879846761591'];

    const found = db.prepare(`SELECT DISTINCT order_id FROM finance_order_lines WHERE store_name='custombase' AND order_id IN (${missing18.map(id => "'" + id + "'").join(',')})`).all();
    console.log('\n18 order yang sempat missing — sekarang ada di DB:', found.length, '/ 18');
    if (found.length < 18) {
        const foundIds = new Set(found.map(r => String(r.order_id)));
        const stillMissing = missing18.filter(id => !foundIds.has(id));
        console.log('Masih belum ada:', stillMissing.length);
        stillMissing.forEach(id => console.log('  -', id));
    } else {
        console.log('✅ Semua 18 order sudah masuk DB!');
    }

    console.log('\n✅ Selesai!');
}

main().catch(e => console.error('Fatal:', e.message, e.stack));
