// Script: Migrasi semua SKU HPP ke global (universal, tidak per-toko)
const { getDb } = require('../lib/pg-connector');
const db = getDb();

const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });

// 1. Untuk setiap distinct SKU, ambil HPP terbaik dan pastikan global entry ada
const allSkus = db.prepare(
    'SELECT lower(sku) as skuLower, sku, MAX(hpp_per_unit) as hpp, MAX(packing_per_unit) as packing, product_name ' +
    'FROM finance_sku_costs WHERE hpp_per_unit > 0 GROUP BY lower(sku)'
).all();

console.log('Total distinct SKU yang akan diglobal-kan:', allSkus.length);

let updated = 0, inserted = 0;
for (const s of allSkus) {
    const globalKey = 'global|' + s.skuLower;
    const ex = db.prepare('SELECT sku_key, hpp_per_unit, packing_per_unit FROM finance_sku_costs WHERE sku_key=?').get(globalKey);
    if (ex) {
        // Update global dengan HPP terbaik (max dari semua toko)
        const bestHpp = Math.max(Number(ex.hpp_per_unit || 0), Number(s.hpp || 0));
        const bestPacking = Math.max(Number(ex.packing_per_unit || 0), Number(s.packing || 0));
        db.prepare('UPDATE finance_sku_costs SET hpp_per_unit=?, packing_per_unit=?, updated_at=? WHERE sku_key=?')
            .run(bestHpp, bestPacking, now, globalKey);
        updated++;
    } else {
        // Insert baru sebagai global
        try {
            db.prepare('INSERT INTO finance_sku_costs(sku_key, store_name, sku, product_name, hpp_per_unit, packing_per_unit, updated_at) VALUES(?,?,?,?,?,?,?)')
                .run(globalKey, 'global', s.sku, s.product_name || '', s.hpp, s.packing, now);
            inserted++;
        } catch (e) { /* duplikat — skip */ }
    }
}
console.log('Updated global entries:', updated, '| Inserted baru ke global:', inserted);

// 2. Migrasi finance_sku_master ke global (set semua store_name = 'global')
try {
    const masterUpdated = db.prepare(
        "UPDATE finance_sku_master SET store_name='global', updated_at=? WHERE store_name NOT IN ('global','all','')"
    ).run(now);
    console.log('finance_sku_master dimigrasi ke global:', masterUpdated.changes, 'rows');
} catch (e) {
    console.log('finance_sku_master tidak ada atau sudah global:', e.message);
}

// 3. Verifikasi hasil akhir
const counts = db.prepare('SELECT store_name, COUNT(*) as c FROM finance_sku_costs GROUP BY store_name').all();
console.log('\nHasil akhir finance_sku_costs:');
counts.forEach(r => console.log(' -', r.store_name, ':', r.c, 'SKU'));

const globalCount = db.prepare('SELECT COUNT(*) as c FROM finance_sku_costs WHERE store_name=?').get('global');
console.log('\nTotal SKU global:', globalCount.c);
