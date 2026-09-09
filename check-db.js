// Cek DB setelah upload — langsung akses SQLite
const db = require('./lib/pg-connector').getDb();
function f(n) { return 'Rp' + Number(n || 0).toLocaleString('id'); }

const o = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet FROM finance_order_lines WHERE store_name='custombase'").get();
const oJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(order_amount),0) as omzet, COALESCE(SUM(seller_discount),0) as disc FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-07%'").get();
const oA = db.prepare("SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' AND created_at LIKE '2026-08%'").get();
const inc = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase'").get();
const incJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(settlement_amount),0) as total FROM finance_income_raw WHERE store_name='custombase' AND order_created_time LIKE '2026-07%'").get();
const ads = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase'").get();
const adsJ = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-07%'").get();
const adsA = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM finance_ad_spend WHERE store_name='custombase' AND spend_date LIKE '2026-08%'").get();
const st = db.prepare("SELECT status, COUNT(*) as c FROM finance_order_lines WHERE store_name='custombase' GROUP BY status ORDER BY c DESC").all();
const allStores = db.prepare("SELECT store_name, COUNT(*) as c FROM finance_order_lines GROUP BY store_name ORDER BY c DESC").all();

console.log('=== DB CHECK (langsung SQLite) ===');
console.log('DB path:', db.name || 'SQLite');
console.log('order ALL  :', o.c, '| Omzet:', f(o.omzet));
console.log('order JULI :', oJ.c, '| Omzet:', f(oJ.omzet), '| Disc:', f(oJ.disc));
console.log('order AGUST:', oA.c);
console.log('income ALL :', inc.c, '| Total:', f(inc.total));
console.log('income JULI:', incJ.c, '| Total:', f(incJ.total));
console.log('ads ALL    :', ads.c, '| Total:', f(ads.total));
console.log('ads JULI   :', adsJ.c, '| Total:', f(adsJ.total));
console.log('ads AGUST  :', adsA.c, '| Total:', f(adsA.total));
console.log('Status custombase:'); st.forEach(r => console.log('  "' + r.status + '":', r.c));
console.log('All stores in DB:'); allStores.forEach(r => console.log('  ' + r.store_name + ':', r.c));
