// Test income_raw ON CONFLICT
const { getDb, pgQuery } = require('./lib/pg-connector');
const db = getDb();

const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get('finance_income_raw');
console.log('Schema:', schema && schema.sql);

const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='finance_income_raw'").all();
console.log('Indexes:', idx.map(i => i.name));

async function main() {
    // Test INSERT dengan ON CONFLICT ... DO NOTHING via pgQuery (normalizeSql)
    try {
        const r = await pgQuery(
            "INSERT INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (store_name, order_id, transaction_type) DO NOTHING",
            ['memora', 'Pesanan', 'TEST-456', '2026-08-01', 10000, 500, 0, 0, '2026-08-13']
        );
        console.log('pgQuery ON CONFLICT result:', r);
        db.prepare('DELETE FROM finance_income_raw WHERE order_id=?').run('TEST-456');
    } catch (e) { console.log('pgQuery ON CONFLICT FAILED:', e.message); }
}
main();
