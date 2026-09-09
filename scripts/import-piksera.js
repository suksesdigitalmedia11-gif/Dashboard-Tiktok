// Import Piksera orders properly
const db=require('better-sqlite3')('./data/finance.db');
const XLSX=require('xlsx');
const now=new Date().toISOString().slice(0,19).replace('T',' ');

function rp(v){const t=String(v||'').trim();if(!t)return 0;const neg=/^-/.test(t);let n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;}
function pd(v){if(!v)return'';const raw=String(v).trim();const m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')+' '+m[4].padStart(2,'0')+':'+m[5].padStart(2,'0')+':00';}return'';}
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');

const file='semua-pesanan-piksera.xlsx';
const STORE='piksera';
console.log('Importing:',file);

const wb=XLSX.readFile(file,{cellDates:false,raw:true});
const sheet=wb.Sheets[wb.SheetNames[0]];
const keys=Object.keys(sheet).filter(k=>k[0]!=='!');
let maxR=0;for(const k of keys){try{const c=XLSX.utils.decode_cell(k);if(c.r>maxR)maxR=c.r;}catch(e){}}

let ins=0,sk=0;const statuses={};const oids=new Set();
const tx=db.transaction(()=>{
  for(let r=2;r<=maxR;r++){
    const get=(c)=>(sheet[XLSX.utils.encode_cell({r,c})]||{}).v;
    const oid=String(get(0)||'').trim();
    if(!oid||!oid.match(/^\d/)){sk++;continue;}
    const status=String(get(1)||'').trim();
    const substatus=String(get(2)||'').trim();
    const sku=String(get(6)||'').trim();
    const product=String(get(7)||'').trim();
    const variation=String(get(8)||'').trim();
    const qty=parseInt(String(get(9)||'0').trim())||0;
    const gross=rp(get(12));
    const disc=Math.abs(rp(get(14)));
    const created=pd(String(get(29)||'').trim());
    if(!created){sk++;continue;}
    
    statuses[status]=(statuses[status]||0)+1;
    oids.add(oid);
    
    const key=ct(STORE)+'|'+ct(oid)+'|'+ct(sku)+'|'+ct(variation);
    db.prepare('INSERT OR IGNORE INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,order_substatus,sku,product_name,variation,quantity,gross_product,seller_discount,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,oid,STORE,'tiktok',created,now,status,substatus,sku,product,variation,qty,gross,disc,file,now);
    ins++;
  }
});
tx();

console.log('Inserted:',ins,'Skipped:',sk);
console.log('Unique OIDs:',oids.size);
console.log('Status:',JSON.stringify(statuses));

// Verifications
console.log('\n=== AUGUST ACCRUAL ===');
const aug=db.prepare("SELECT COUNT(DISTINCT order_id) as c,SUM(gross_product) as g,SUM(seller_discount) as d FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status IN ('Selesai','Dikirim')").get(STORE);
console.log('Eligible:',aug.c,'Gross:',Math.round(aug.g),'Disc:',Math.round(aug.d),'Net:',Math.round(aug.g-aug.d));
console.log('Expected: 104, 3,176,600, 1,936,765, 1,239,835');
console.log('Gross '+(Math.abs(aug.g-3176600)<=1?'✅':'❌'),'Net',(Math.abs(aug.g-aug.d-1239835)<=1?'✅':'❌'));

console.log('\n=== AUGUST SETTLEMENT (Selesai only) ===');
const augS=db.prepare("SELECT COUNT(DISTINCT order_id) as c,SUM(gross_product) as g,SUM(seller_discount) as d FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Selesai'").get(STORE);
console.log('Selesai:',augS.c,'Gross:',Math.round(augS.g),'Disc:',Math.round(augS.d),'Net:',Math.round(augS.g-augS.d));
console.log('Expected: 27, 735,000, 501,021, 233,979');

console.log('\n=== ALL PERIOD ===');
const all=db.prepare("SELECT status,COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? GROUP BY status ORDER BY c DESC").all(STORE);
for(const r of all)console.log(' ',r.status,':',r.c);

console.log('\n=== ALL ACCRUAL ===');
const allAcc=db.prepare("SELECT COUNT(DISTINCT order_id) as c,SUM(gross_product) as g,SUM(seller_discount) as d FROM finance_order_lines WHERE store_name=? AND status IN ('Selesai','Dikirim')").get(STORE);
console.log('Eligible:',allAcc.c,'Gross:',Math.round(allAcc.g),'Disc:',Math.round(allAcc.d),'Net:',Math.round(allAcc.g-allAcc.d));

console.log('\n=== CANCEL VALID ===');
const cvAll=db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND status='Dibatalkan' AND (cancel_reason LIKE '%Pengiriman paket gagal%' OR cancel_reason LIKE '%Paket hilang%')").get(STORE);
console.log('Cancel Valid ALL:',cvAll.c,'(expected 2)');

const cvAug=db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Dibatalkan' AND (cancel_reason LIKE '%Pengiriman paket gagal%' OR cancel_reason LIKE '%Paket hilang%')").get(STORE);
console.log('Cancel Valid August:',cvAug.c,'(expected 0)');

// Multi-line check
const multi=db.prepare("SELECT COUNT(*) as c FROM (SELECT order_id FROM finance_order_lines WHERE store_name=? GROUP BY order_id HAVING COUNT(*)>1)").get(STORE);
console.log('\nMulti-line orders:',multi.c);

db.close();
console.log('\nDONE');
