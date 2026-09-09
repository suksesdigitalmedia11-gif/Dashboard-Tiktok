/**
 * Product Packing Reconciliation
 * Ensures SUM(product packing allocation) = store packing EXACT
 */
const db = require('better-sqlite3')('./data/finance.db');

function computeJulyPacking() {
  const STORE = 'custombase';
  
  // Get all July orders with their SKU lines
  const orders = db.prepare(`
    SELECT order_id, sku, tracking_id, package_id, quantity, gross_product, seller_discount, status, cancel_reason
    FROM finance_order_lines 
    WHERE store_name=? AND created_at >= '2026-07-01' AND created_at < '2026-08-01'
    AND status IN ('Selesai','Dikirim')
  `).all(STORE);
  
  // Group by packing_key (tracking_id > package_id > order_id)
  const packages = new Map();
  for (const o of orders) {
    const pk = (o.tracking_id || o.package_id || o.order_id || '').trim();
    if (!pk) continue;
    if (!packages.has(pk)) packages.set(pk, []);
    packages.get(pk).push(o);
  }
  
  // Cancel-valid packages
  const cvOrders = db.prepare(`
    SELECT order_id, sku, tracking_id, package_id, quantity, gross_product, seller_discount
    FROM finance_order_lines 
    WHERE store_name=? AND created_at >= '2026-07-01' AND created_at < '2026-08-01'
    AND status='Dibatalkan'
  `).all(STORE);
  
  const cvPackages = new Map();
  for (const o of cvOrders) {
    const cr = (o.cancel_reason || '').toLowerCase();
    if (!cr.includes('pengiriman paket gagal') && !cr.includes('paket hilang')) continue;
    const pk = (o.tracking_id || o.package_id || o.order_id || '').trim();
    if (!pk) continue;
    if (!cvPackages.has(pk)) cvPackages.set(pk, []);
    cvPackages.get(pk).push(o);
  }
  
  const PACKING_COST = 2000;
  const allPackages = new Map([...packages, ...cvPackages]);
  
  // Store-level packing (already verified)
  const storePackingSelesai = packages.size * PACKING_COST;
  const storePackingCV = cvPackages.size * PACKING_COST;
  const storePackingTotal = storePackingSelesai + storePackingCV;
  
  // Product-level packing: allocate per SKU within each package
  const skuPacking = new Map();
  
  for (const [pk, lines] of allPackages) {
    if (lines.length === 1) {
      // Single SKU package: allocate 100%
      const sku = lines[0].sku || 'Unknown';
      const key = sku;
      skuPacking.set(key, (skuPacking.get(key) || 0) + PACKING_COST);
    } else {
      // Multi-SKU package: allocate based on seller net revenue share
      const totalNet = lines.reduce((s, l) => {
        const net = Math.abs(Number(l.gross_product || 0)) - Math.abs(Number(l.seller_discount || 0));
        return s + Math.max(0, net);
      }, 0);
      
      if (totalNet <= 0) {
        // Equal split if all zero revenue
        const share = PACKING_COST / lines.length;
        let allocated = 0;
        for (let i = 0; i < lines.length; i++) {
          const sku = lines[i].sku || 'Unknown';
          const portion = (i === lines.length - 1) ? PACKING_COST - allocated : Math.round(share);
          skuPacking.set(sku, (skuPacking.get(sku) || 0) + portion);
          allocated += portion;
        }
      } else {
        let allocated = 0;
        for (let i = 0; i < lines.length; i++) {
          const net = Math.max(0, Math.abs(Number(lines[i].gross_product || 0)) - Math.abs(Number(lines[i].seller_discount || 0)));
          const sku = lines[i].sku || 'Unknown';
          if (i === lines.length - 1) {
            // Last line gets the remainder
            const portion = PACKING_COST - allocated;
            skuPacking.set(sku, (skuPacking.get(sku) || 0) + portion);
          } else {
            const portion = Math.round(PACKING_COST * net / totalNet);
            skuPacking.set(sku, (skuPacking.get(sku) || 0) + portion);
            allocated += portion;
          }
        }
      }
    }
  }
  
  const productPackingTotal = Array.from(skuPacking.values()).reduce((s, v) => s + v, 0);
  const diff = storePackingTotal - productPackingTotal;
  
  return {
    store: {
      selesai: storePackingSelesai,
      cv: storePackingCV,
      total: storePackingTotal,
      packages: packages.size,
      cvPackages: cvPackages.size,
    },
    product: {
      total: productPackingTotal,
      skuCount: skuPacking.size,
      allocation: Object.fromEntries([...skuPacking.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
    },
    diff,
    reconciled: Math.abs(diff) <= 1,
  };
}

const result = computeJulyPacking();
console.log('Store Packing Selesai:', result.store.selesai.toLocaleString('id-ID'), '(' + result.store.packages + ' pkgs)');
console.log('Store Packing CV:', result.store.cv.toLocaleString('id-ID'), '(' + result.store.cvPackages + ' pkgs)');
console.log('Store Packing Total:', result.store.total.toLocaleString('id-ID'));
console.log('Product Packing Total:', result.product.total.toLocaleString('id-ID'));
console.log('Diff:', result.diff);
console.log('Reconciled (≤Rp1):', result.reconciled ? '✅' : '❌');
console.log('Top 10 SKU allocations:');
for (const [sku, amount] of Object.entries(result.product.allocation)) {
  console.log('  ' + sku + ': Rp' + amount.toLocaleString('id-ID'));
}

db.close();
