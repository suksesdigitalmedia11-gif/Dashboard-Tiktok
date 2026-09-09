const XLSX = require('xlsx');
const db = require('./lib/pg-connector').getDb();
const rp = n => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
const sep = () => console.log('-'.repeat(70));

// === BACA FILE CAIR ===
console.log('\n=== FILE: cair juli custombase.xlsx ===');
const f = XLSX.readFile('cair juli custombase.xlsx');
console.log('Sheets:', f.SheetNames.join(', '));

f.SheetNames.forEach(sn => {
    const ws = f.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) { console.log(sn + ': (kosong)'); return; }
    const cols = Object.keys(rows[0] || {});
    console.log('\nSheet:', sn, '(' + rows.length + ' baris)');
    console.log('  Kolom 1-6:', cols.slice(0, 6).join(' | '));

    // Cari kolom order id
    const idCol = cols.find(c =>
        c.toLowerCase().includes('id pesanan') || c.toLowerCase().includes('order id') ||
        c.toLowerCase().includes('pesanan/peny')
    );
    if (idCol) {
        const validIds = rows.map(r => String(r[idCol] || '').trim()).filter(id =>
            id.length > 5 && !id.toLowerCase().includes('id pesanan')
        );
        const uniqueIds = new Set(validIds);
        console.log('  Unique Order ID:', uniqueIds.size);
        [...uniqueIds].slice(0, 3).forEach(id => console.log('    -', id));
    }

    // Hitung kolom-kolom jumlah/amount
    const amtCols = cols.filter(c =>
        c.toLowerCase().includes('jumlah') ||
        c.toLowerCase().includes('pendapatan') ||
        c.toLowerCase().includes('penyelesaian')
    );
    amtCols.slice(0, 4).forEach(col => {
        const t = rows.reduce((s, r) => {
            const v = parseFloat(String(r[col] || 0).replace(/[^0-9.-]/g, ''));
            return s + (isNaN(v) ? 0 : v);
        }, 0);
        if (Math.abs(t) > 1000) console.log('  Total "' + col + '":', rp(t));
    });

    // Cek jenis transaksi
    const txCol = cols.find(c => c.toLowerCase().includes('jenis transaksi') || c.toLowerCase().includes('transaction type'));
    if (txCol) {
        const types = {};
        rows.forEach(r => {
            const t = String(r[txCol] || '').trim();
            if (t) types[t] = (types[t] || 0) + 1;
        });
        console.log('  Jenis transaksi:');
        Object.entries(types).slice(0, 10).forEach(([t, c]) => console.log('   ', t, ':', c, 'baris'));
    }
});

// === AUDIT IKLAN DI DB ===
console.log('\n\n=== AUDIT IKLAN GMV DI DB ===');
sep();
const iklan = db.prepare(`
  SELECT spend_date, channel, campaign, SUM(amount) as total, COUNT(*) as cnt
  FROM finance_ad_spend
  WHERE store_name='custombase' AND spend_date LIKE '2026-07%'
  GROUP BY spend_date, channel, campaign
  ORDER BY spend_date DESC
  LIMIT 30
`).all();
const totalIklan = iklan.reduce((s, r) => s + (r.total || 0), 0);
console.log('Total di DB:', rp(totalIklan));
console.log('Baris per (date, channel, campaign):');
iklan.forEach(r =>
    console.log(' ', r.spend_date, '|', r.channel, '|', String(r.campaign).slice(0, 25).padEnd(25), '|', rp(r.total), '| cnt:', r.cnt)
);

// === CEK IKLAN DARI INCOME_RAW ===
console.log('\n=== IKLAN GMV DARI income_raw ===');
const incomeAds = db.prepare(`
  SELECT transaction_type, COUNT(*) as cnt, SUM(total_revenue) as rev, SUM(total_fees) as fees
  FROM finance_income_raw
  WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'
    AND (transaction_type LIKE '%Iklan%' OR transaction_type LIKE '%GMV%' OR transaction_type LIKE '%iklan%')
  GROUP BY transaction_type
`).all();
if (incomeAds.length === 0) {
    console.log('Tidak ada iklan di income_raw');
} else {
    incomeAds.forEach(r => console.log(' ', r.transaction_type, ':', r.cnt, 'baris | rev:', rp(r.rev), '| fees:', rp(r.fees)));
}

// Total settlement_amount dari income Juli
const incTotal = db.prepare(`
  SELECT COUNT(*) as cnt, SUM(settlement_amount) as total
  FROM finance_income_raw
  WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'
    AND transaction_type NOT LIKE '%Iklan%' AND transaction_type NOT LIKE '%GMV%'
`).get();
console.log('\nIncome order settlement Juli (non-iklan):', incTotal.cnt, 'ordr =', rp(incTotal.total));
