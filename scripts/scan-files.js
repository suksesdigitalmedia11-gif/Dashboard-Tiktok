// Scan XLSX files for order classification and May fixture detection
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const DATA = path.join('data tiktok', 'custombase');
const files = fs.readdirSync(DATA).filter(f => f.endsWith('.xlsx'));

function parseDate(v) {
  if (!v) return '';
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const raw = String(v).trim();
  const s = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (s) return (s[3].length === 2 ? '20' + s[3] : s[3]) + '-' + s[2].padStart(2, '0') + '-' + s[1].padStart(2, '0');
  const i = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (i) return i[1] + '-' + i[2].padStart(2, '0') + '-' + i[3].padStart(2, '0');
  return '';
}

for (const file of files) {
  const fp = path.join(DATA, file);
  const sizeKB = (fs.statSync(fp).size / 1024).toFixed(1);
  
  // Read first sheet
  const wb = XLSX.readFile(fp, { cellDates: false, raw: true });
  const sn = wb.SheetNames[0];
  const sheet = wb.Sheets[sn];
  const keys = Object.keys(sheet).filter(k => k[0] !== '!');
  let maxR = 0;
  for (const k of keys) { try { const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; } catch (e) { } }
  
  const headers = [];
  for (let c = 0; c < 80; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    headers.push(cell ? String(cell.v || '').trim() : '');
  }
  
  // Classify by headers
  const headerStr = headers.filter(h => h).join('|');
  const isOrder = headerStr.includes('Order ID') && headerStr.includes('Order Status') && headerStr.includes('Created Time');
  const isIncome = headerStr.includes('ID Pesanan/Penyesuaian') && headerStr.includes('Jenis transaksi');
  const isAds = headerStr.includes('Transaction ID') && headerStr.includes('Transaction type');
  const isReturn = headerStr.includes('Return Order ID') && headerStr.includes('Return Status');
  
  const type = isOrder ? 'ORDER' : isIncome ? 'INCOME' : isAds ? 'ADS' : isReturn ? 'RETURN' : 'UNKNOWN';
  
  console.log(`\n=== ${file} (${sizeKB} KB) ===`);
  console.log(`  Type: ${type}`);
  console.log(`  Sheet: ${sn}, Rows: ${maxR}, Headers: ${headers.filter(h=>h).length}`);
  console.log(`  First 8 headers: ${headers.filter(h=>h).slice(0,8).join(' | ')}`);
  
  if (type === 'ORDER') {
    // Scan for dates
    let minDate = '', maxDate = '';
    const oids = new Set();
    let maySelesai = 0;
    
    for (let r = 1; r <= Math.min(maxR, 200); r++) {
      const createdCell = sheet[XLSX.utils.encode_cell({ r, c: headers.findIndex(h => h.includes('Created Time')) })];
      const statusCell = sheet[XLSX.utils.encode_cell({ r, c: headers.findIndex(h => h.includes('Order Status')) })];
      const oidCell = sheet[XLSX.utils.encode_cell({ r, c: headers.findIndex(h => h.includes('Order ID')) })];
      
      if (!oidCell || !createdCell) continue;
      const oid = String(oidCell.v || '').trim();
      if (!oid || oid.toLowerCase().includes('platform unique')) continue;
      
      const d = parseDate(createdCell.v);
      if (!d) continue;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
      
      oids.add(oid);
      
      const status = String(statusCell?.v || '').trim();
      if (d.startsWith('2026-05') && status === 'Selesai') maySelesai++;
    }
    
    // Full scan for May
    let totalLines = 0, mayLines = 0, maySelesaiOrders = new Set(), mayAllOids = new Set();
    for (let r = 1; r <= maxR; r++) {
      const oidIdx = headers.findIndex(h => h.includes('Order ID'));
      const createdIdx = headers.findIndex(h => h.includes('Created Time'));
      const statusIdx = headers.findIndex(h => h.includes('Order Status'));
      const oidCell = sheet[XLSX.utils.encode_cell({ r, c: oidIdx })];
      if (!oidCell) continue;
      const oid = String(oidCell.v || '').trim();
      if (!oid || oid.toLowerCase().includes('platform unique')) continue;
      totalLines++;
      
      const createdCell = sheet[XLSX.utils.encode_cell({ r, c: createdIdx })];
      const d = parseDate(createdCell?.v);
      if (!d || !d.startsWith('2026-05')) continue;
      mayLines++;
      mayAllOids.add(oid);
      
      const statusCell = sheet[XLSX.utils.encode_cell({ r, c: statusIdx })];
      const status = String(statusCell?.v || '').trim();
      if (status === 'Selesai') maySelesaiOrders.add(oid);
    }
    
    console.log(`  Date range: ${minDate} s/d ${maxDate}`);
    console.log(`  Total logical lines: ${totalLines}`);
    console.log(`  May 2026 lines: ${mayLines}`);
    console.log(`  May unique Order IDs: ${mayAllOids.size}`);
    console.log(`  May Selesai unique orders: ${maySelesaiOrders.size}`);
    console.log(`  Has May 1 data: ${minDate <= '2026-05-01' ? '✅ YES' : '❌ NO (starts ' + minDate + ')'}`);
    console.log(`  Golden Mei target: 588 Selesai → ${maySelesaiOrders.size === 588 ? '✅ MATCH' : maySelesaiOrders.size < 588 ? '❌ LESS (' + maySelesaiOrders.size + ' vs 588)' : '❌ MORE'}`);
  }
}
