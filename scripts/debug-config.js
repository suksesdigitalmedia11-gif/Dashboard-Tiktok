process.env.TURSO_URL = 'libsql://dashboard-keuangan-tiktok-rzkyjlnsyh.aws-us-east-1.turso.io';
process.env.TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUzMDc0MDEsImlkIjoiMDE5ZmFjOWMtYTQwMS03NTI1LTkzMWYtNDczMDg5MTlmMDE4Iiwia2lkIjoiRTdIa2VCNTliR0NSQUE4MHpWQVQ2eU10Z21LQUpMWmJzeTdMc3pRSHZRUSIsInJpZCI6IjY2YzVmNzRjLWViYmItNDlhNS04NDBiLWMwYzAyMGRjZGIxMyJ9.IKw_pDIxdRurxZujjVqQ2YrmlePIg-Nrjw5s3FXcWQ2I24tYdNoKK-NP0mt8G4SbJMHMWwfF2xBzNc242a3gDQ';
delete process.env.DATABASE_URL;

const pg = require('../lib/pg-connector');
const finance = require('../lib/finance-cloud');

(async () => {
  await pg.initSchema();

  // 1. Check raw DB
  console.log('1. RAW DB CHECK ===');
  const raw = await pg.pgQuery("SELECT value FROM finance_config WHERE key='app'");
  if (raw.rows.length === 0) {
    console.log('   ❌ NO CONFIG ROW AT ALL!');
  } else {
    const val = raw.rows[0].value;
    console.log('   Value type:', typeof val);
    console.log('   Raw prefix:', String(val).substring(0, 200));
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      console.log('   stores:', parsed.stores);
    } catch (e) {
      console.log('   ❌ Cannot parse:', e.message);
    }
  }

  // 2. Check readConfig output
  console.log('\n2. readConfig() ===');
  const cfg = await finance.readConfig();
  console.log('   stores:', cfg.stores);
  console.log('   defaultStore:', cfg.defaultStore);

  // 3. Check summary availableStores
  console.log('\n3. availableStores from summary ===');
  const s = await finance.computeSummary({ preset: 'thisMonth', store: 'custombase' });
  console.log('   availableStores:', s.availableStores);

  // 4. Check frontend flow: what does /api/config return?
  console.log('\n4. What /api/config returns (simulate GET) ===');
  const safeCfg = finance.safeConfig(cfg);
  console.log('   stores:', safeCfg.stores);
  console.log('   defaultStore:', safeCfg.defaultStore);
})().catch(e => console.error(e));
