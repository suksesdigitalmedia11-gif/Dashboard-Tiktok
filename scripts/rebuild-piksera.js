// PIKsera FULL REBUILD v2
const db=require('better-sqlite3')('./data/finance.db');
const XLSX=require('xlsx');
const now=new Date().toISOString().slice(0,19).replace('T',' ');
const STORE='piksera';
function rp(v){const t=String(v||'').trim();if(!t)return 0;const neg=/^-/.test(t);let n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;}
function pd(v){if(!v)return '';const raw=String(v).trim();const m=raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');const dm=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(dm){const y=dm[3].length===2?'20'+dm[3]:dm[3];return y+'-'+dm[2].padStart(2,'0')+'-'+dm[1].padStart(2,'0');}return '';}
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const fmt=n=>'Rp'+Math.round(n||0).toLocaleString('id-ID');

console.log('=== PIKsera REBUILD ===');

// CLEAR
['finance_order_lines','finance_income_raw','finance_ad_spend','finance_returns'].forEach(t=>{
  const r=db.prepare('DELETE FROM '+t+' WHERE store_name=?').run(STORE);
  console.log(t+': '+r.changes+' deleted');
});

// ORDERS
console.log('\n--- ORDERS ---');
const wb=XLSX.readFile('semua-pesanan-piksera.xlsx',{cellDates:false,raw:true});
const sheet=wb.Sheets.OrderSKUList;
const keys=Object.keys(sheet).filter(k=>k[0]!=='!');
let maxR=0;keys.forEach(k=>{try{const c=XLSX.utils.decode_cell(k);if(c.r>maxR)maxR=c.r;}catch(e){}});
let oIns=0;
const oTx=db.transaction(()=>{
  for(let r=2;r<=maxR;r++){
    const g=c=>(sheet[XLSX.utils.encode_cell({r:r,c:c})]||{}).v;
    const oid=String(g(0)||'').trim();if(!oid||!/^\d/.test(oid))continue;
    const status=String(g(1)||'').trim();
    const substatus=String(g(2)||'').trim();
    const sku=String(g(6)||'').trim();
    const product=String(g(7)||'').trim();
    const variation=String(g(8)||'').trim();
    const qty=parseInt(String(g(9)||'0'))||0;
    const gross=rp(g(12));const disc=Math.abs(rp(g(14)));
    const refund=Math.abs(rp(g(22)));
    const orderAmt=rp(g(28));
    const created=pd(String(g(29)||'').trim());if(!created)continue;
    const cancelReason=String(g(36)||'').trim();
    const trackingId=String(g(39)||'').trim();
    const packageId=String(g(57)||'').trim();
    const shipped=pd(String(g(32)||'').trim());
    const cancelled=pd(String(g(34)||'').trim());
    const key=ct(STORE)+'|'+ct(oid)+'|'+ct(sku)+'|'+ct(variation);
    db.prepare('INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,order_substatus,sku,product_name,variation,quantity,gross_product,seller_discount,refund_amount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,cancelled_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,oid,STORE,'tiktok',created,now,status,substatus,sku,product,variation,qty,gross,disc,refund,orderAmt,trackingId,packageId,cancelReason,shipped,cancelled,'semua-pesanan-piksera.xlsx',now);
    oIns++;
  }
});
oTx();
console.log(oIns+' orders inserted');

// INCOME - transaksi
console.log('\n--- INCOME ---');
const wbInc=XLSX.readFile('transaksi-piksera.xlsx',{cellDates:false,raw:true});
const incData=XLSX.utils.sheet_to_json(wbInc.Sheets['Detail pesanan'],{defval:''});
let iIns=0;
const iTx=db.transaction(()=>{
  incData.forEach(r=>{
    const type=String(r['Jenis transaksi']||'').trim();
    const oid=String(r['ID Pesanan/Penyesuaian']||'').trim();
    if(!oid||!type)return;
    const oc=pd(r['Waktu pemesanan']);if(!oc)return;
    const sa=pd(r['Waktu pembayaran pesanan']);
    db.prepare('INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(STORE,type,oid,oc,rp(r['Jumlah penyelesaian pembayaran']),rp(r['Total Biaya']),Math.abs(rp(r['Subtotal pengembalian dana setelah diskon penjual'])),rp(r['Jumlah penyesuaian']),now,sa,String(r['Total Pendapatan']||'').trim());
    iIns++;
  });
});
iTx();
console.log(iIns+' income from transaksi');

// INCOME - penarikan dana (dedup)
const wbInc2=XLSX.readFile('dari-menu-penarikan-dana-semua.xlsx',{cellDates:false,raw:true});
const incData2=XLSX.utils.sheet_to_json(wbInc2.Sheets['Detail pesanan'],{defval:''});
let iIns2=0,iDup=0;
const iTx2=db.transaction(()=>{
  incData2.forEach(r=>{
    const type=String(r['Jenis transaksi']||'').trim();
    const oid=String(r['ID Pesanan/Penyesuaian']||'').trim();
    if(!oid||!type)return;
    const oc=pd(r['Waktu pemesanan']);if(!oc)return;
    const res=db.prepare('INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(STORE,type,oid,oc,rp(r['Jumlah penyelesaian pembayaran']),rp(r['Total Biaya']),Math.abs(rp(r['Subtotal pengembalian dana setelah diskon penjual'])),rp(r['Jumlah penyesuaian']),now,pd(r['Waktu pembayaran pesanan']),String(r['Total Pendapatan']||'').trim());
    if(res.changes)iIns2++;else iDup++;
  });
});
iTx2();
console.log(iIns2+' new, '+iDup+' duplicates from penarikan-dana');

// ADS
console.log('\n--- ADS ---');
const wbAd=XLSX.readFile('iklan-toko-piksera.xlsx',{cellDates:false,raw:true});
const adData=XLSX.utils.sheet_to_json(wbAd.Sheets.sheet1,{defval:''});
let aIns=0,aSuc=0,aFail=0;
const aTx=db.transaction(()=>{
  adData.forEach(r=>{
    const tid=String(r['Transaction ID']||'').trim();if(!tid)return;
    const status=String(r['Status']||'').trim();
    const txnType=String(r['Transaction type']||'').trim();
    const txnSub=String(r['Transaction subtype']||'').trim();
    const desc=String(r['Description']||'').trim();
    const sd=pd(r['Transaction time']).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(sd))return;
    const amt=Math.abs(rp(r['Amount']));
    if(status==='Success')aSuc++;else aFail++;
    let ch='',cp='';
    if(status==='Success'){
      if(txnType==='General'&&txnSub==='Add balance'){ch='TikTok Top Up';cp='Bank Transfer';}
      else if(txnType==='Promotions'){ch='TikTok Promotions';cp='Issued';}
      else{ch='TikTok '+txnType;cp=txnSub;}
    }else{ch='TikTok Failed';}
    db.prepare('INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)').run(STORE,sd,amt,ch,cp,desc.substring(0,200),now,now,tid,status);
    aIns++;
  });
});
aTx();
console.log(aIns+' ads ('+aSuc+' Success, '+aFail+' Failed)');

// VERIFY
console.log('\n=== VERIFY ===');
const v=db.prepare('SELECT COUNT(*) as c FROM finance_order_lines WHERE store_name=?').get(STORE);
console.log('Orders: '+v.c);
const vi=db.prepare('SELECT COUNT(*) as c,SUM(settlement_amount) as s,SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type=?').get(STORE,'Pesanan');
console.log('Income Pesanan: '+vi.c+' rows, settle='+fmt(vi.s)+', fee='+fmt(Math.abs(vi.f)));
const va=db.prepare('SELECT COUNT(*) as c,SUM(amount) as a FROM finance_ad_spend WHERE store_name=?').get(STORE);
console.log('Ads: '+va.c+' rows, total='+fmt(va.a));
const aug=db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status IN ('Selesai','Dikirim')").get(STORE);
console.log('Aug Accrual eligible: '+aug.c);
const cv=db.prepare("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND status='Dibatalkan' AND cancel_reason LIKE '%Pengiriman paket gagal%'").get(STORE);
console.log('Cancel Valid: '+cv.c);

db.close();
console.log('\nDONE');
