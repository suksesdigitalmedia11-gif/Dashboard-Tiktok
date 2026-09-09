// API Integration Test — verify computeSummary via production endpoint
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 9877;
process.env.PORT = PORT;

const server = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
server.stderr.on('data', d => output += d);
server.stdout.on('data', d => output += d);

function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${endpoint}`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse error: ${data.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Wait for server
  await new Promise(r => setTimeout(r, 4000));

  const tests = [];
  const fmt = n => 'Rp' + Math.round(n||0).toLocaleString('id-ID');

  try {
    // Test July Settlement
    const julSet = await apiGet(`/api/summary?preset=month&month=2026-07&store=custombase&mode=settlement`);
    const t = julSet.totals;
    
    const checks = [
      ['July Settlement', t.settlement, 85128507],
      ['July Platform Fee', t.platformFee, 29336536],
      ['July GMV', t.adSpendSettlement, 18416187],
      ['July Orders', t.finalOrders, 6196],
      ['July Omzet Net', t.omzet, 109740197],
      ['July Penggantian', t.adjustmentAmount, 144500],
      ['July HPP', t.hpp, 23581200],
      ['July Packing', t.packing, 12646000],
    ];

    console.log('=== API JULI SETTLEMENT ===');
    let pass = 0;
    for (const [name, actual, expected] of checks) {
      const ok = Math.abs(actual - expected) <= 1;
      if (ok) pass++;
      console.log(`  ${ok ? '✅' : '❌'} ${name}: ${fmt(actual)} (expected ${fmt(expected)})`);
    }
    console.log(`  ${pass}/${checks.length} passed`);
    tests.push({ name: 'July Settlement', pass, total: checks.length });

    // Test July Accrual
    const julAcc = await apiGet(`/api/summary?preset=month&month=2026-07&store=custombase&mode=accrual`);
    const a = julAcc.totals;
    const accChecks = [
      ['Accrual Eligible', a.finalOrders + a.estimatedOrders, 6575],
      ['Accrual Omzet', a.omzet, 118408118],
    ];
    console.log('\n=== API JULI ACCRUAL ===');
    let pass2 = 0;
    for (const [name, actual, expected] of accChecks) {
      const ok = Math.abs(actual - expected) <= 1;
      if (ok) pass2++;
      console.log(`  ${ok ? '✅' : '❌'} ${name}: ${fmt(actual)} (expected ${fmt(expected)})`);
    }
    console.log(`  ${pass2}/${accChecks.length} passed`);
    tests.push({ name: 'July Accrual', pass: pass2, total: accChecks.length });

    // Test May Settlement
    const maySet = await apiGet(`/api/summary?preset=month&month=2026-05&store=custombase&mode=settlement`);
    const m = maySet.totals;
    const mayChecks = [
      ['May Settlement', m.settlement, 8772345],
      ['May Platform Fee', m.platformFee, 3223291],
      ['May GMV', m.adSpendSettlement, 1472709],
    ];
    console.log('\n=== API MEI SETTLEMENT ===');
    let pass3 = 0;
    for (const [name, actual, expected] of mayChecks) {
      const ok = Math.abs(actual - expected) <= 1;
      if (ok) pass3++;
      console.log(`  ${ok ? '✅' : '❌'} ${name}: ${fmt(actual)} (expected ${fmt(expected)})`);
    }
    console.log(`  ${pass3}/${mayChecks.length} passed`);
    tests.push({ name: 'May Settlement', pass: pass3, total: mayChecks.length });

  } catch(e) {
    console.error('API test error:', e.message);
  }

  // Kill server
  server.kill();
  
  const totalPass = tests.reduce((s,t) => s + t.pass, 0);
  const totalTests = tests.reduce((s,t) => s + t.total, 0);
  console.log(`\n╔══════════════════════════════╗`);
  console.log(`║  API TEST: ${totalPass}/${totalTests} passed       ║`);
  console.log(`╚══════════════════════════════╝`);
  process.exit(totalPass === totalTests ? 0 : 1);
}

main();
