const db = require('./lib/pg-connector').getDb();
const XLSX = require('xlsx');
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

// Step 1: Hapus entri lama yang tidak punya transaction_id (tidak bisa deduplicate)
const del = db.prepare(
    "DELETE FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%' AND (transaction_id IS NULL OR transaction_id = '')"
);
const delResult = del.run();
console.log('[step1] Hapus entri lama (null txId):', delResult.changes, 'entri');

// Step 2: Import dari file Excel
const iklan = XLSX.readFile('iklan juli custombase.xlsx');
const rows = XLSX.utils.sheet_to_json(iklan.Sheets[iklan.SheetNames[0]], { defval: '' });
console.log('[step2] Baris di file Excel:', rows.length);

const parseAmount = v => Math.abs(parseFloat(String(v || '').replace(/[^0-9.-]/g, '')) || 0);
const parseDate = v => {
    const m = String(v || '').match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO finance_ad_spend 
    (store_name, spend_date, amount, channel, campaign, note, transaction_id, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
);

let inserted = 0;
let totalInserted = 0;
let skipped = 0;

const importAll = db.transaction(() => {
    rows.forEach((r, i) => {
        const date = parseDate(r['Transaction time']);
        const amount = parseAmount(r['Amount']);
        if (!date || amount <= 0) { skipped++; return; }

        const txId = String(r['Transaction ID'] || '').trim() || `gmv_cb_jul26_${i}`;
        const subtype = String(r['Transaction subtype'] || r['Transaction type'] || '').trim();

        insertStmt.run(
            'custombase',
            date,
            amount,
            'TikTok GMV Ads',
            subtype,
            'Imported: iklan juli custombase.xlsx',
            txId,
            'completed'
        );
        inserted++;
        totalInserted += amount;
    });
});

importAll();
console.log('[step2] Inserted:', inserted, 'entri =', rp(totalInserted));
console.log('[step2] Dilewati:', skipped, '(tanpa tanggal/amount)');

// Step 3: Verifikasi
const v = db.prepare(
    "SELECT COUNT(*) as cnt, SUM(amount) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'"
).get();
console.log('[verifikasi] Total akhir di DB:', v.cnt, 'entri =', rp(v.total));
console.log('✅ Import iklan GMV selesai!');
