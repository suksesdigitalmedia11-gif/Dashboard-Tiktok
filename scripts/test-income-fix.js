// Test fix importIncomeRows langsung (tanpa server)
const path = require('path');
process.chdir(path.join(__dirname, '..'));

async function main() {
    const { importRows, initSchema } = require('./lib/finance-cloud');
    const pg = require('./lib/pg-connector');
    await pg.initSchema();

    const XLSX = require('xlsx');

    // Clear memora income_raw dulu untuk test bersih
    const db = pg.getDb();
    const before = db.prepare('SELECT COUNT(*) as c FROM finance_income_raw WHERE store_name=?').get('memora');
    console.log('income_raw memora BEFORE:', before.c);

    // Upload penarikan-dana-memora.xlsx langsung
    const wb = XLSX.readFile('penarikan-dana-memora.xlsx');
    // Pilih sheet Detail pesanan
    const sheetName = wb.SheetNames.find(s => s === 'Detail pesanan') || wb.SheetNames[0];
    console.log('Sheet dipilih:', sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    console.log('Rows dari sheet:', rows.length);

    const result = await importRows({
        storeName: 'memora',
        kind: 'income',
        filename: 'penarikan-dana-memora.xlsx',
        rows,
    });
    console.log('Import result:', JSON.stringify(result, null, 2));

    const after = db.prepare('SELECT COUNT(*) as c, SUM(settlement_amount) as total FROM finance_income_raw WHERE store_name=?').get('memora');
    console.log('income_raw memora AFTER:', after);

    // Cek settlement_received di order_lines
    const orders = db.prepare('SELECT COUNT(*) as c, SUM(settlement_received) as sr FROM finance_order_lines WHERE store_name=?').get('memora');
    console.log('order_lines settlement_received sum:', orders);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
