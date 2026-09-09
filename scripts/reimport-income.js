// Quick re-import income only
const db=require('better-sqlite3')('./data/finance.db');
const XLSX=require('xlsx');
const path=require('path');
const STORE='custombase', DATA=path.join('data tiktok','custombase');
const now=()=>new Date().toISOString().slice(0,19).replace('T',' ');
function rp_s(v){const t=String(v||'').trim();if(!t)return 0;const neg=/^-/.test(t);let n=t.replace(/[^\d,.\-]/g,'');if(n.startsWith('+'))n=n.slice(1);const p=Number.parseFloat(n.replace(/,/g,''));return Number.isFinite(p)?Math.round(Math.abs(p)*(neg?-1:1)):0;}
function parseDate(v){if(!v)return'';if(typeof v==='number')return new Date(Date.UTC(1899,11,30)+v*86400000).toISOString().slice(0,19).replace('T',' ');const raw=String(v).trim();const s=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);if(s){const y=s[3].length===2?'20'+s[3]:s[3];return y+'-'+s[2].padStart(2,'0')+'-'+s[1].padStart(2,'0')+' '+(s[4]||'00').padStart(2,'0')+':'+(s[5]||'00').padStart(2,'0')+':'+(s[6]||'00').padStart(2,'0');}const i=raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);if(i)return i[1]+'-'+i[2].padStart(2,'0')+'-'+i[3].padStart(2,'0')+' '+(i[4]||'00').padStart(2,'0')+':'+(i[5]||'00').padStart(2,'0')+':'+(i[6]||'00').padStart(2,'0');return'';}
function field(row,...names){for(const n of names)if(row[n]!==undefined)return row[n];return'';}
function readSheet(wb,sn){const sheet=wb.Sheets[sn];if(!sheet)throw new Error('Sheet '+sn);const keys=Object.keys(sheet).filter(k=>k[0]!=='!');let maxR=0,maxC=0;for(const k of keys){try{const c=XLSX.utils.decode_cell(k);if(c.r>maxR)maxR=c.r;if(c.c>maxC)maxC=c.c;}catch(e){}}const hdrs=[];for(let c=0;c<=maxC;c++){const cell=sheet[XLSX.utils.encode_cell({r:0,c})];hdrs.push(cell?String(cell.v||'').trim():'');}const rows=[];for(let r=1;r<=maxR;r++){const row={};for(let c=0;c<=maxC;c++){const cell=sheet[XLSX.utils.encode_cell({r,c});if(cell&&cell.v!==undefined&&cell.v!=='')row[hdrs[c]]=cell.v;}if(Object.keys(row).length>0)rows.push(row);}return rows;}

const files=['penarikan-dana-mei-akhir juni.xlsx','penarikan-dana-1 juli - sekarang.xlsx'];
let total=0;
for(const file of files){
  const fp=path.join(DATA,file);
  console.log(file+'...');
  const wb=XLSX.readFile(fp,{cellDates:false,raw:true});
  const sn=wb.SheetNames.find(s=>s.includes('Detail'))||wb.SheetNames[0];
  const rows=readSheet(wb,sn);
  let ins=0,skip=0,dup=0;
  const tx=db.transaction(()=>{
    for(const row of rows){
      const type=String(field(row,'Jenis transaksi')||'').trim();
      const oid=String(field(row,'ID Pesanan/Penyesuaian')||'').trim();
      if(!oid||!type||type.startsWith('Return')){skip++;continue;}
      const orderCreated=parseDate(field(row,'Waktu pemesanan'));
      const settledAt=parseDate(field(row,'Waktu pembayaran pesanan'));
      if(!orderCreated){skip++;continue;}
      const fees=rp_s(field(row,'Total Biaya','Jumlah biaya'));
      const r=db.prepare('INSERT OR IGNORE INTO finance_income_raw(store_name,transaction_type,order_id,order_created_time,settlement_amount,total_fees,refund_amount,adjustment_amount,imported_at,settled_at,total_revenue) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(STORE,type,oid,orderCreated,rp_s(field(row,'Jumlah penyelesaian pembayaran')),fees,Math.abs(rp_s(field(row,'Subtotal pengembalian dana setelah diskon penjual'))),rp_s(field(row,'Jumlah penyesuaian')),now(),settledAt,String(field(row,'Total Pendapatan')||'').trim());
      if(r.changes)ins++;else dup++;
    }
  });
  tx();
  console.log('  '+ins+' inserted, '+dup+' duplicates, '+skip+' skipped');
  total+=ins;
}

const cnt=db.prepare("SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name='custombase'").get();
const bd=db.prepare("SELECT transaction_type,COUNT(*) as c FROM finance_income_raw WHERE store_name='custombase' GROUP BY transaction_type").all();
console.log('\nTotal events: '+cnt.c);
for(const r of bd)console.log('  '+r.transaction_type+': '+r.c);

const may=db.prepare("SELECT SUM(settlement_amount) as s,SUM(total_fees) as f FROM finance_income_raw WHERE store_name='custombase' AND transaction_type='Pesanan' AND order_created_time>='2026-05-01' AND order_created_time<'2026-06-01'").get();
console.log('\nMay Settlement: '+Math.round(may.s)+' (expected 8,772,345) '+((Math.abs(may.s-8772345)<=1)?'✅':'❌'));
console.log('May Fee: '+Math.abs(Math.round(may.f))+' (expected 3,223,291) '+((Math.abs(Math.abs(may.f)-3223291)<=1)?'✅':'❌'));

const julF=db.prepare("SELECT SUM(total_fees) as f FROM finance_income_raw WHERE store_name='custombase' AND transaction_type='Pesanan' AND order_created_time>='2026-07-01' AND order_created_time<'2026-08-01'").get();
console.log('July Fee: '+Math.abs(Math.round(julF.f))+' (expected 29,336,536) '+((Math.abs(Math.abs(julF.f)-29336536)<=1)?'✅':'❌'));
db.close();
