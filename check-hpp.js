const db = require('./lib/pg-connector').getDb();

const orders = db.prepare("SELECT order_id, created_at, status, sku, quantity, gross_product, seller_discount, order_amount, platform_fee FROM finance_order_lines WHERE store_name='custombase' AND sku LIKE '%stkfoto8%' AND created_at LIKE '2026-07%' LIMIT 5").all();
console.log('=== SAMPLE ORDER LINES (stkfoto8, Juli) ===');
orders.forEach(r => console.log(JSON.stringify(r)));

const hpp = db.prepare("SELECT sku, store_name, hpp_per_unit, packing_per_unit FROM finance_sku_costs WHERE sku LIKE '%stkfoto8%' LIMIT 5").all();
console.log('\n=== HPP di DB ===');
hpp.forEach(r => console.log(JSON.stringify(r)));

const stats = db.prepare("SELECT status, COUNT(*) as orders, SUM(quantity) as qty FROM finance_order_lines WHERE store_name='custombase' AND sku LIKE '%stkfoto8%' AND created_at LIKE '2026-07%' GROUP BY status").all();
console.log('\n=== STATUS BREAKDOWN stkfoto8 Juli ===');
stats.forEach(r => console.log(r.status, '| orders:', r.orders, '| total qty:', r.qty));
