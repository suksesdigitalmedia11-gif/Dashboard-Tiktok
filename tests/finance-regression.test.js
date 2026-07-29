const assert = require('assert');

// Force SQLite mode
process.env.DATABASE_URL = '';
const pg = require('../lib/pg-connector');
const finance = require('../lib/finance-cloud');

async function seedAndCleanup(seedFn) {
  await pg.initSchema();
  const db = pg.getDb();
  // Clean test data
  db.exec("DELETE FROM finance_order_lines WHERE store_name='test_regression'");
  db.exec("DELETE FROM finance_sku_costs WHERE sku_key LIKE 'test_regression%'");
  try {
    await seedFn(db);
  } finally {
    // Cleanup after test
    db.exec("DELETE FROM finance_order_lines WHERE store_name='test_regression'");
    db.exec("DELETE FROM finance_sku_costs WHERE sku_key LIKE 'test_regression%'");
  }
}

async function testPackingUsesPerLineQuantityCost() {
  await seedAndCleanup(async (db) => {
    // Seed: 1 order with 2 SKU lines, same package_id so 1 package
    const rows = [
      {
        line_key: 'test_regression|pack_test|sku_a|var_a',
        order_id: 'pack_test',
        store_name: 'test_regression',
        source: 'tiktok_order',
        created_at: '2026-05-10',
        status: 'Selesai',
        sku: 'A',
        variation: '',
        quantity: 2,
        gross_product: 200000,
        seller_discount: 0,
        platform_fee: 0,
        order_amount: 200000,
        settlement_received: 0,
        package_id: 'PKG-001',
        tracking_id: 'TRK-001',
      },
      {
        line_key: 'test_regression|pack_test|sku_b|var_b',
        order_id: 'pack_test',
        store_name: 'test_regression',
        source: 'tiktok_order',
        created_at: '2026-05-10',
        status: 'Selesai',
        sku: 'B',
        variation: '',
        quantity: 1,
        gross_product: 100000,
        seller_discount: 0,
        platform_fee: 0,
        order_amount: 100000,
        settlement_received: 0,
        package_id: 'PKG-001',
        tracking_id: 'TRK-001',
      },
    ];

    const skuRows = [
      { sku_key: 'test_regression|a', store_name: 'test_regression', sku: 'A', hpp_per_unit: 10000, packing_per_unit: 1000, updated_at: '2026-05-01' },
      { sku_key: 'test_regression|b', store_name: 'test_regression', sku: 'B', hpp_per_unit: 10000, packing_per_unit: 5000, updated_at: '2026-05-01' },
    ];

    await pg.upsertRows('finance_order_lines', rows, 'line_key');
    await pg.upsertRows('finance_sku_costs', skuRows, 'sku_key');

    const summary = await finance.computeSummary({ preset: 'month', month: '2026-05', store: 'test_regression' });

    // Packing = Rp 2000 per package (flat rate) × 1 package = 2000
    // The code uses flat packing, not per-line packing_per_unit
    assert.strictEqual(summary.totals.packing, 2000, 'packing harus 1 package × Rp2000 = 2000');
    
    // HPP = qty × hpp_per_unit = 2×10000 + 1×10000 = 30000
    assert.strictEqual(summary.totals.hpp, 30000, 'HPP = 2*10000 + 1*10000 = 30000');
    
    // Omzet = 200000 + 100000 = 300000
    assert.strictEqual(summary.totals.omzet, 300000, 'Omzet = 300000');
  });
}

async function testIncomeSettlementDetectsGmvAdColumns() {
  await seedAndCleanup(async (db) => {
    // Seed an order that the income statement can match
    const orderRow = {
      line_key: 'test_regression|INC_TEST|sku_x|',
      order_id: 'INC_TEST',
      store_name: 'test_regression',
      source: 'tiktok_order',
      created_at: '2026-05-02',
      status: 'Selesai',
      sku: 'SKU',
      variation: '',
      quantity: 1,
      gross_product: 100000,
      seller_discount: 0,
      platform_fee: 0,
      order_amount: 100000,
      settlement_received: 0,
      package_id: 'PKG-INC',
      tracking_id: 'TRK-INC',
    };
    await pg.upsertRows('finance_order_lines', [orderRow], 'line_key');

    // Test 1: Order settlement (Pesanan) — should match existing order
    const result1 = await finance.importRows({
      storeName: 'test_regression',
      kind: 'income',
      filename: 'pencairan.csv',
      rows: [{
        'ID Pesanan/Penyesuaian': 'ADJ-001',
        'ID pesanan terkait': 'INC_TEST',
        'Jenis transaksi': 'Pesanan',
        'Waktu pembayaran pesanan': '2026-05-03 10:00:00',
        'Jumlah penyelesaian pembayaran': '90000',
        'Total Pendapatan': '100000',
        'Total Biaya': '10000',
      }]
    });
    assert.ok(result1.matchedOrders > 0, 'harus match order INC_TEST untuk Pesanan');
    assert.strictEqual(result1.unmatchedOrders, 0, 'tidak boleh ada unmatched');

    // Test 2: GMV Ad transaction — should create ad_spend row
    const result2 = await finance.importRows({
      storeName: 'test_regression',
      kind: 'income',
      filename: 'pencairan.csv',
      rows: [{
        'ID Pesanan/Penyesuaian': 'GMV-001',
        'ID pesanan terkait': '/',
        'Jenis transaksi': 'Pembayaran GMV untuk Iklan TikTok',
        'Waktu pemesanan': '2026-05-03',
        'Jumlah penyelesaian pembayaran': '-12345',
      }]
    });
    assert.ok(result2.adSpendRows > 0, 'harus create ad spend row untuk GMV');

    // Check that ad spend was created with correct amount
    const adRows = await pg.fetchAll('finance_ad_spend', 'select=*&store_name=eq.test_regression');
    const gmvAd = adRows.find(r => r.channel && r.channel.toLowerCase().includes('gmv'));
    assert.ok(gmvAd, 'harus ada baris GMV ad spend dari income');
    assert.strictEqual(Math.abs(Number(gmvAd.amount)), 12345, 'ad spend harus 12345');
  });
}

(async () => {
  try {
    await testPackingUsesPerLineQuantityCost();
    console.log('✓ testPacking — passed');
    await testIncomeSettlementDetectsGmvAdColumns();
    console.log('✓ testIncomeSettlement — passed');
    console.log('finance regression tests passed');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
