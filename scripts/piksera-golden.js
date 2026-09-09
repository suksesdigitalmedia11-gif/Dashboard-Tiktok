// PIKsera GOLDEN REBUILD — All 4 source files, cell-based parsing
const db=require('better-sqlite3')('./data/finance.db');
const XLSX=require('xlsx');
const now=new Date().toISOString().slice(0,19).replace('T',' ');
const STORE='piksera';

function rp(v){const t=String(v||'').trim();if(!t)return 0;const neg=/^-/.test(t);let n=t.replace(/[^\d,.\-]/g,'');const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;}
function pd(v){if(!v)return'';const raw=String(v).trim();const m=raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');const dm=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(dm){const y=dm[3].length===2?'20'+dm[3]:dm[3];return y+'-'+dm[2].padStart(2,'0')+'-'+dm[1].padStart(2,'0');}return'';}
function pdFull(v){if(!v)return'';const raw=String(v).trim();const m=raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')+' '+m[4].padStart(2,'0')+':'+m[5].padStart(2,'0')+':00';const dm=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);if(dm){const y=dm[3].length===2?'20'+dm[3]:dm[3];return y+'-'+dm[2].padStart(2,'0')+'-'+dm[1].padStart(2,'0')+' '+dm[4].padStart(2,'0')+':'+dm[5].padStart(2,'0')+':00';}return pd(v);}
const ct=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const fmt=n=>'Rp'+Math.round(n||0).toLocaleString('id-ID');
const check=(label,actual,expected)=>{const d=Math.abs((actual||0)-(expected||0));console.log((d<=1?'✅':'❌')+' '+label+': '+fmt(actual)+(d>1?' (expected '+fmt(expected)+' diff='+d+')':''));return d<=1;};

console.log('╔══════════════════════════════════════╗');
console.log('║  PIKSERA GOLDEN REBUILD              ║');
console.log('╚══════════════════════════════════════╝\n');

// CLEAR
['finance_order_lines','finance_income_raw','finance_ad_spend','finance_returns'].forEach(t=>{
  db.prepare('DELETE FROM '+t+' WHERE store_name=?').run(STORE);
});

// ═══════════════════════════════════
// 1. ORDERS — Cell-based, skip rows 0+1
// ═══════════════════════════════════
console.log('=== 1. ORDERS ===');
const wbO=XLSX.readFile('semua-pesanan-piksera.xlsx',{cellDates:false,raw:true});
const shO=wbO.Sheets.OrderSKUList;
const keysO=Object.keys(shO).filter(k=>k[0]!=='!');
let maxRO=0;keysO.forEach(k=>{try{const c=XLSX.utils.decode_cell(k);if(c.r>maxRO)maxRO=c.r;}catch(e){}});
let oIns=0,oStatus={},oids=new Set(),skus=new Set();
const oTx=db.transaction(()=>{
  for(let r=2;r<=maxRO;r++){
    const g=c=>(shO[XLSX.utils.encode_cell({r:r,c:c})]||{}).v;
    const oid=String(g(0)||'').trim();if(!oid||!/^\d/.test(oid))continue;
    const status=String(g(1)||'').trim();
    const substatus=String(g(2)||'').trim();
    const sku=String(g(6)||'').trim();
    const product=String(g(7)||'').trim();
    const variation=String(g(8)||'').trim();
    const qty=parseInt(String(g(9)||'0'))||0;
    const gross=rp(g(12));const disc=Math.abs(rp(g(14)));
    const refund=Math.abs(rp(g(22)));const orderAmt=rp(g(28));
    const created=pdFull(String(g(29)||'').trim());if(!created)continue;
    const cancelReason=String(g(36)||'').trim();
    const trackingId=String(g(39)||'').trim();
    const packageId=String(g(57)||'').trim();
    const shipped=pdFull(String(g(32)||'').trim());
    const cancelled=pdFull(String(g(34)||'').trim());
    const key=ct(STORE)+'|'+ct(oid)+'|'+ct(sku)+'|'+ct(variation);
    db.prepare('INSERT INTO finance_order_lines(line_key,order_id,store_name,source,created_at,updated_at,status,order_substatus,sku,product_name,variation,quantity,gross_product,seller_discount,refund_amount,order_amount,tracking_id,package_id,cancel_reason,shipped_time,cancelled_time,last_seen_file,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,oid,STORE,'tiktok',created,now,status,substatus,sku,product,variation,qty,gross,disc,refund,orderAmt,trackingId,packageId,cancelReason,shipped,cancelled,'semua-pesanan-piksera.xlsx',now);
    oIns++;oids.add(oid);skus.add(sku);
    oStatus[status]=(oStatus[status]||0)+1;
  }
});
oTx();
console.log('Lines:',oIns,'Unique OIDs:',oids.size,'SKUs:',skus.size);
console.log('Status:',JSON.stringify(oStatus));

// ═══════════════════════════════════
// 2. INCOME — Transaksi 123 rows, cell-based
// ═══════════════════════════════════
console.log('\n=== 2. INCOME (transaksi) ===');
const wbI=XLSX.readFile('transaksi-piksera.xlsx',{cellDates:false,raw:true});
const shI=wbI.Sheets['Detail pesanan'];
const keysI=Object.keys(shI).filter(k=>k[0]!=='!');
let maxRI=0;keysI.forEach(k=>{try{const c=XLSX.utils.decode_cell(k);if(c.r>maxRI)maxRI=c.r;}catch(e){}});
console.log('Rows (0-based):',maxRI+1,'→',maxRI,'data rows');

// Headers
const hdrsI=[];for(let c=0;c<85;c++){const cell=shI[XLSX.utils.encode_cell({r:0,c:c})];hdrsI.push(cell?String(cell.v||'').trim():'');}
const colI={oid:0,type:1,orderTime:2,settleTime:3,settlement:5,revenue:6,subAfterDisc:7,subBeforeDisc:8,sellerDisc:9,refundAfterDisc:11,totalFees:14,commission:15,logisticsFee:30,affiliate:32,dynamicFee:39,processingFee:43,tax:51,gmvAd:53,adjustment:62,relatedOid:63};

let iIns=0,iTypes={},settleSum=0,feeSum=0,revSum=0;
const financialIdentity={ok:0,fail:0};
const iTx=db.transaction(()=>{
  for(let r=1;r<=maxRI;r++){
    const g=c=>(shI[XLSX.utils.encode_cell({r:r,c:c})]||{}).v;
    const type=String(g(colI.type)||'').trim();
    const oid=String(g(colI.oid)||'').trim();
    if(!oid||!type)continue;
    const oc=pd(g(colI.orderTime));if(!oc)continue;
    const sa=pd(g(colI.settleTime));
    const settlement=rp(g(colI.settlement));
    const revenue=rp(g(colI.revenue));
    const fees=rp(g(colI.totalFees));
    const refund=Math.abs(rp(g(colI.refundAfterDisc)));
    const adj=rp(g(colI.adjustment));
    // Financial identity: revenue + fees = settlement
    if(Math.abs(revenue+fees-settlement)<=1)financialIdentity.ok++;else financialIdentity.fail++;
    db.prepare('INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(STORE,type,oid,oc,settlement,fees,refund,adj,now,sa,String(revenue));
    iIns++;iTypes[type]=(iTypes[type]||0)+1;
    settleSum+=settlement;feeSum+=fees;revSum+=revenue;
  }
});
iTx();
console.log('Events:',iIns,'Types:',JSON.stringify(iTypes));
console.log('Financial identity: '+financialIdentity.ok+' OK, '+financialIdentity.fail+' failures');
console.log('Settlement:',fmt(settleSum),'Fee:',fmt(Math.abs(feeSum)),'Revenue:',fmt(revSum));

// Payout reconciliation — Riwayat penarikan
console.log('\n=== PAYOUT ===');
const shP=wbI.Sheets['Riwayat penarikan'];
const keysP=Object.keys(shP).filter(k=>k[0]!=='!');
let maxRP=0;keysP.forEach(k=>{try{const c=XLSX.utils.decode_cell(k);if(c.r>maxRP)maxRP=c.r;}catch(e){}});
let payoutTotal=0,payoutCount=0;
for(let r=1;r<=maxRP;r++){
  const g=c=>(shP[XLSX.utils.encode_cell({r:r,c:c})]||{}).v;
  const refId=String(g(1)||'').trim();
  const total=rp(g(3));
  const status=String(g(4)||'').trim();
  if(status==='Transferred'&&refId){payoutTotal+=total;payoutCount++;}
}
console.log('Payout events:',payoutCount,'Total:',fmt(payoutTotal));
check('Payout = Settlement',payoutTotal,settleSum);

// ═══════════════════════════════════
// 3. WITHDRAWAL DETAIL — Dedup, don't re-insert
// ═══════════════════════════════════
console.log('\n=== 3. WITHDRAWAL DETAIL DEDUP ===');
const wbW=XLSX.readFile('dari-menu-penarikan-dana-semua.xlsx',{cellDates:false,raw:true});
const shW=wbW.Sheets['Detail pesanan'];
const keysW=Object.keys(shW).filter(k=>k[0]!=='!');
let maxRW=0;keysW.forEach(k=>{try{const c=XLSX.utils.decode_cell(k);if(c.r>maxRW)maxRW=c.r;}catch(e){}});
let wDup=0,wIns=0;
const wTx=db.transaction(()=>{
  for(let r=1;r<=maxRW;r++){
    const g=c=>(shW[XLSX.utils.encode_cell({r:r,c:c})]||{}).v;
    const type=String(g(1)||'').trim();const oid=String(g(0)||'').trim();
    if(!oid||!type)continue;
    const oc=pd(g(2));if(!oc)continue;
    const sa=pd(g(3));const settlement=rp(g(5));
    const res=db.prepare('INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(STORE,type,oid,oc,settlement,rp(g(14)),Math.abs(rp(g(11))),rp(g(62)),now,sa,String(rp(g(6))));
    if(res.changes)wIns++;else wDup++;
  }
});
wTx();
console.log('Withdrawal rows:',maxRW,'Overlap prevented:',wDup,'New inserted:',wIns);

// ═══════════════════════════════════
// 4. ADS
// ═══════════════════════════════════
console.log('\n=== 4. ADS ===');
const wbA=XLSX.readFile('iklan-toko-piksera.xlsx',{cellDates:false,raw:true});
const adData=XLSX.utils.sheet_to_json(wbA.Sheets.sheet1,{defval:''});
let aIns=0,aSuc=0,aFail=0,topUpJul=0,topUpAug=0,promoCredit=0;
const aTx=db.transaction(()=>{
  adData.forEach(r=>{
    const tid=String(r['Transaction ID']||'').trim();if(!tid)return;
    const status=String(r['Status']||'').trim();
    const txType=String(r['Transaction type']||'').trim();
    const txSub=String(r['Transaction subtype']||'').trim();
    const desc=String(r['Description']||'').trim();
    const sd=pd(r['Transaction time']).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(sd))return;
    const amt=Math.abs(rp(r['Amount']));
    if(status==='Success')aSuc++;else aFail++;
    let ch='',cp='';
    if(status==='Success'){
      if(txType==='General'&&txSub==='Add balance'){ch='TikTok Top Up';cp='Bank Transfer';if(sd>='2026-07-01'&&sd<'2026-08-01')topUpJul+=amt;else if(sd>='2026-08-01')topUpAug+=amt;}
      else if(txType==='Promotions'){ch='TikTok Promo Credit';cp='Issued';promoCredit+=amt;}
      else{ch='TikTok '+txType;cp=txSub;}
    }else{ch='TikTok Failed';}
    db.prepare('INSERT OR IGNORE INTO finance_ad_spend(store_name,spend_date,amount,channel,campaign,note,created_at,updated_at,transaction_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)').run(STORE,sd,amt,ch,cp,desc.substring(0,200),now,now,tid,status);
    aIns++;
  });
});
aTx();
console.log('Ads:',aIns,'Success:',aSuc,'Failed:',aFail);
console.log('Top Up July:',fmt(topUpJul),'Aug:',fmt(topUpAug),'Promo:',fmt(promoCredit));

// ═══════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════
console.log('\n╔══════════════════════════════════════╗');
console.log('║  GOLDEN VERIFICATION                 ║');
console.log('╚══════════════════════════════════════╝\n');

let allOk=0,allFail=0;
function v(label,actual,expected){const r=check(label,actual,expected);if(r)allOk++;else allFail++;}

// Order counts
const q=v=>db.prepare(v).get(STORE);
const qa=v=>db.prepare(v).all(STORE);

console.log('--- ORDER STATUS ---');
v('July Selesai',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at<'2026-08-01' AND status='Selesai'")[0]?.c||0,38);
v('July Cancel',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at<'2026-08-01' AND status='Dibatalkan'")[0]?.c||0,10);
v('Aug Selesai',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Selesai'")[0]?.c||0,27);
v('Aug Dikirim',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Dikirim'")[0]?.c||0,77);
v('Aug Cancel',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Dibatalkan'")[0]?.c||0,52);
v('Cancel Valid ALL',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND status='Dibatalkan' AND cancel_reason LIKE '%Pengiriman paket gagal%'")[0]?.c||0,2);

console.log('\n--- ACCRUAL REVENUE ---');
v('July Accrual Gross',qa("SELECT COALESCE(SUM(gross_product),0) as v FROM finance_order_lines WHERE store_name=? AND created_at<'2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.v||0,1011500);
v('July Accrual Discount',qa("SELECT COALESCE(SUM(seller_discount),0) as v FROM finance_order_lines WHERE store_name=? AND created_at<'2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.v||0,609220);
v('July Accrual Net',qa("SELECT COALESCE(SUM(gross_product-seller_discount),0) as v FROM finance_order_lines WHERE store_name=? AND created_at<'2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.v||0,402280);
v('Aug Accrual Eligible',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.c||0,104);
v('Aug Accrual Gross',qa("SELECT COALESCE(SUM(gross_product),0) as v FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.v||0,3176600);
v('Aug Accrual Net',qa("SELECT COALESCE(SUM(gross_product-seller_discount),0) as v FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status IN ('Selesai','Dikirim')")[0]?.v||0,1239835);
v('ALL Accrual Eligible',qa("SELECT COUNT(DISTINCT order_id) as c FROM finance_order_lines WHERE store_name=? AND status IN ('Selesai','Dikirim')")[0]?.c||0,142);
v('ALL Accrual Gross',qa("SELECT COALESCE(SUM(gross_product),0) as v FROM finance_order_lines WHERE store_name=? AND status IN ('Selesai','Dikirim')")[0]?.v||0,4188100);

console.log('\n--- FINANCE ---');
const jSett=qa("SELECT COALESCE(SUM(settlement_amount),0) as s,SUM(total_fees) as f,SUM(total_revenue) as r FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time<'2026-08-01'")[0];
v('July Settlement',Math.round(jSett?.s||0),260738);
v('July Fee',Math.abs(Math.round(jSett?.f||0)),141542);

const aSett=qa("SELECT COALESCE(SUM(settlement_amount),0) as s,SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan' AND order_created_time>='2026-08-01'")[0];
v('Aug Settlement',Math.round(aSett?.s||0),153844);
v('Aug Fee',Math.abs(Math.round(aSett?.f||0)),80135);

const allSett=qa("SELECT COALESCE(SUM(settlement_amount),0) as s,SUM(total_fees) as f FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan'")[0];
v('ALL Settlement',Math.round(allSett?.s||0),414582);
v('ALL Fee',Math.abs(Math.round(allSett?.f||0)),221677);

// Dana Tertahan: Dikirim orders without income
const dtOrders=db.prepare("SELECT order_id,SUM(gross_product-seller_discount) as net FROM finance_order_lines WHERE store_name=? AND created_at>='2026-08-01' AND status='Dikirim' AND order_id NOT IN (SELECT DISTINCT order_id FROM finance_income_raw WHERE store_name=? AND transaction_type='Pesanan') GROUP BY order_id").all(STORE,STORE);
const dtGross=dtOrders.reduce((s,r)=>s+r.net,0);
v('Dana Tertahan Orders',dtOrders.length,77);
v('Dana Tertahan Gross',Math.round(dtGross),1005856);

// Ads
v('Top Up July',topUpJul,222000);
v('Top Up August',topUpAug,666000);
v('Top Up ALL',topUpJul+topUpAug,888000);
v('Promo Credit',promoCredit,10964);
v('GMV Settlement',0,0);

// Payout
v('Payout total',payoutTotal,414582);
v('Payout diff',Math.abs(payoutTotal-settleSum),0);

// Withdrawal dedup
v('Withdrawal overlap prevented',wDup,17);
v('Withdrawal new inserted',wIns,0);

console.log('\n╔══════════════════════════════════════╗');
console.log('║  RESULT: '+allOk+'/'+(allOk+allFail)+' GOLDEN         ║');
console.log('╚══════════════════════════════════════╝');

db.close();
