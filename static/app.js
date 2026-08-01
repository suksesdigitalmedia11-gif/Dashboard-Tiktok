const routeRole = location.pathname.includes("tv") ? "tv" : location.pathname.includes("team") ? "team" : "owner";
const isCloudPreview = !["127.0.0.1", "localhost", ""].includes(location.hostname) && location.protocol !== "file:";
const defaultStores = ["ventura", "giftyours", "custombase"];
const state = {
  view: routeRole === "tv" ? "tv" : routeRole === "team" ? "team" : "owner",
  accessRole: routeRole,
  summary: null,
  config: null,
  filters: { preset: "thisMonth", month: "", store: "all" },
  pendingFilters: { preset: "thisMonth", month: "", store: "all" },
  calcMode: "accrual", // "accrual" or "settlement"
  skuSort: "profit",
  skuStatus: "all",
  statusSort: "late",
  statusFilter: "all",
  folderStore: "ventura",
  drilldown: null, // { title, rows, total, formula }
};

const el = (id) => document.getElementById(id);
const fmt = (n) => "Rp" + Math.round(Number(n || 0)).toLocaleString("id-ID");
const fmtExact = (n) => "Rp" + Math.round(Number(n || 0)).toLocaleString("id-ID");  // Exact, no rounding
const fmtCompact = (n) => {
  const value = Math.round(Number(n || 0));
  if (Math.abs(value) >= 1_000_000_000) return "Rp" + (value / 1_000_000_000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M";
  if (Math.abs(value) >= 1_000_000) return "Rp" + (value / 1_000_000).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " jt";
  if (Math.abs(value) >= 1_000) return "Rp" + (value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 }) + " rb";
  return fmt(value);
};
const num = (n) => Math.round(Number(n || 0)).toLocaleString("id-ID");
const pct = (n) => {
  const value = Number(n || 0);
  const digits = Math.abs(value) > 0 && Math.abs(value) < 1 ? 2 : 1;
  return `${value.toFixed(digits)}%`;
};
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthLabel = (value) => {
  if (!value || !value.includes("-")) return "Pilih bulan";
  const [year, month] = value.split("-");
  return `${monthNames[Number(month) - 1]} ${year}`;
};
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

function showNotice(message, level = "warn", popup = false) {
  const text = message || "Terjadi kesalahan.";
  if (el("alerts")) {
    el("alerts").innerHTML = `
      <div class="alert ${level}">
        <strong>Perhatian</strong>
        <div>${escapeHtml(text)}</div>
      </div>
    ` + el("alerts").innerHTML;
  }
  if (popup) window.alert(text);
}

function cloudBlocked(action) {
  if (!isCloudPreview) return false;
  showNotice(`${action} belum bisa membaca folder laptop dari Vercel. Untuk online, upload file langsung di dashboard Vercel; untuk auto-folder 5-10 menit kita butuh worker lokal yang mengirim file Desty ke Supabase.`);
  return true;
}

function setView(view) {
  state.view = view;
  state.accessRole = routeRole !== "owner" ? routeRole : view === "tv" ? "tv" : view === "team" ? "team" : "owner";
  document.body.classList.toggle("tv", view === "tv");
  document.body.classList.toggle("team", view === "team");
  document.body.classList.toggle("restricted", state.accessRole !== "owner");
  document.body.classList.toggle("cloud-preview", isCloudPreview);
  document.querySelectorAll("[data-owner-only]").forEach(btn => btn.hidden = routeRole !== "owner");
  document.querySelectorAll("nav button").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  document.querySelectorAll("[data-show]").forEach(section => {
    const allowed = section.dataset.show.split(",").map(x => x.trim());
    section.hidden = !allowed.includes(view);
  });
  el("pageTitle").textContent =
    view === "tv" ? "Monitor Operasional" :
    view === "team" ? "Dashboard Tim" :
    view === "ops" ? "Upload & Otomatis" :
    view === "quality" ? "Data Quality Center" :
    view === "sku" ? "Detail SKU" :
    view === "stores" ? "Dashboard Per Toko" :
    view === "accounting" ? "Laporan Akuntansi" :
    "Owner Dashboard";
  el("pageSub").textContent =
    view === "tv" ? "Tampilan aman untuk tim: order, omset, status, dan SKU bergerak cepat." :
    view === "team" ? "Mode aman untuk tim: data operasional terlihat, profit dan biaya rahasia disembunyikan." :
    view === "ops" ? "Upload data terbaru, jalankan auto update folder, dan aktifkan laporan Telegram." :
    view === "quality" ? "Deteksi SKU tanpa HPP, order belum cair, pencairan tidak matched, cancel/refund besar, dan data duplikat." :
    view === "sku" ? "Cari SKU yang benar-benar menghasilkan profit dan SKU yang perlu diperbaiki." :
    view === "stores" ? "Bandingkan performa ventura, giftyours, dan custombase dalam satu layar." :
    view === "accounting" ? "Laba rugi, neraca mini, arus kas, dan pajak per bulan per toko." :
    "Profit, dana tertahan, potongan, HPP, forecast, dan rekomendasi asisten.";
  el("trendTitle").textContent = state.accessRole !== "owner" ? "Omset 30 Hari" : "Omset & Profit 30 Hari";
  refresh().catch(err => alert(err.message));
}

function withOwnerPin(options = {}) {
  // For FormData (file upload), let browser auto-set Content-Type
  if (options.body instanceof FormData) {
    const pin = localStorage.getItem("pareOwnerPin") || "";
    const headers = {};
    if (pin) headers["X-Owner-Pin"] = pin;
    return { cache: "no-store", ...options, headers };
  }
  const headers = new Headers(options.headers || {});
  const pin = localStorage.getItem("pareOwnerPin") || "";
  if (pin) headers.set("X-Owner-Pin", pin);
  return { cache: "no-store", ...options, headers };
}

async function api(path, options, retryOwnerPin = true) {
  const res = await fetch(path, withOwnerPin(options || {}));
  let data;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error("Server belum mengirim jawaban yang bisa dibaca. Coba refresh halaman atau gunakan dashboard lokal.");
  }
  if (res.status === 401 && data.ownerLocked && retryOwnerPin && state.accessRole === "owner") {
    const pin = window.prompt("Masukkan PIN Owner");
    if (pin) {
      localStorage.setItem("pareOwnerPin", pin);
      return api(path, options, false);
    }
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

function summaryParams() {
  const params = new URLSearchParams();
  params.set("preset", state.filters.preset);
  if (state.filters.preset === "month" && state.filters.month) params.set("month", state.filters.month);
  if (state.filters.preset === "custom") {
    var sd = document.getElementById("startDateFilter");
    var ed = document.getElementById("endDateFilter");
    if (sd && sd.value) params.set("startDate", sd.value);
    if (ed && ed.value) params.set("endDate", ed.value);
  }
  params.set("store", state.filters.store);
  params.set("role", state.accessRole);
  params.set("mode", state.calcMode || "accrual");
  params.set("_", Date.now().toString());
  return params.toString();
}

function summaryUrl() {
  return "/api/summary?" + summaryParams();
}

function syncFilterControls() {
  document.querySelectorAll("[data-preset]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === state.pendingFilters.preset);
  });
  if (el("monthFilter")) el("monthFilter").value = state.pendingFilters.month || "";
  if (el("storeFilter")) el("storeFilter").value = state.pendingFilters.store || "all";
}

let filterApplyTimer = null;
function scheduleApplyFilters(delay = 180) {
  clearTimeout(filterApplyTimer);
  filterApplyTimer = setTimeout(() => applyFilters().catch(err => showNotice(err.message)), delay);
}

async function applyFilters() {
  state.filters = { ...state.pendingFilters };
  const button = el("applyFilters");
  if (button) {
    button.disabled = true;
    button.textContent = "Memuat...";
  }
  try {
    await refresh();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Terapkan";
    }
  }
}

async function refresh() {
  if (state.view === "accounting") {
    const accounting = await fetchAccounting();
    renderAccounting(accounting);
    return;
  }
  if (state.view === "quality") {
    await loadDataQuality();
    return;
  }
  // Load dari summary API saja (sudah include daily, sku, operation, stores)
  var summary = await api(summaryUrl()).then(function(r) { return (r && r.totals ? r : { totals: {} }); }).catch(function(e) { return { totals: {} }; });
  state.summary = summary;
  var availStores = summary.availableStores || defaultStores;
  var availMonths = summary.availableMonths || [];
  if (!availMonths.length && summary.generatedAt) {
    var now = new Date();
    for (var i = 0; i < 12; i++) {
      var y = now.getFullYear();
      var m = String(now.getMonth() + 1).padStart(2, "0");
      availMonths.push(y + "-" + m);
      now.setMonth(now.getMonth() - 1);
    }
  }
  render(summary);
}
  
// Load Data Quality data in parallel
async function loadSummary() {
  try {
    await loadDataQuality();
  } catch (err) {
    // quality data is secondary, don't block
  }
}

function populateStores(stores) {
  stores = Array.from(new Set([...(stores || []), ...defaultStores])).filter(Boolean);
  const options = [`<option value="all">Semua Toko</option>`].concat(
    stores.map(s => `<option value="${s}">${s}</option>`)
  ).join("");
  const storeValue = state.pendingFilters.store || state.filters.store;
  el("storeFilter").innerHTML = options;
  el("storeFilter").value = [...el("storeFilter").options].some(opt => opt.value === storeValue) ? storeValue : state.filters.store;
  const uploadOptions = stores.map(s => `<option value="${s}">${s}</option>`).join("");
  const uploadValue = el("uploadStore").value;
  const folderValue = el("folderStore").value || state.folderStore;
  const adValue = el("adStore").value;
  el("uploadStore").innerHTML = uploadOptions;
  el("folderStore").innerHTML = uploadOptions;
  el("adStore").innerHTML = uploadOptions;
  const firstStore = stores[0] || "ventura";
  el("uploadStore").value = stores.includes(uploadValue) ? uploadValue : firstStore;
  el("folderStore").value = stores.includes(folderValue) ? folderValue : firstStore;
  el("adStore").value = stores.includes(adValue) ? adValue : firstStore;
}

function populateMonths(months) {
  const monthSelect = el("monthFilter");
  const previous = state.pendingFilters.month || state.filters.month || monthSelect.value;
  monthSelect.innerHTML = `<option value="">Semua bulan</option>` + (
    months.length
      ? months.map(month => `<option value="${month}">${monthLabel(month)}</option>`).join("")
      : ""
  );
  if (previous && months.includes(previous)) {
    monthSelect.value = previous;
    state.pendingFilters.month = previous;
  } else if (state.pendingFilters.preset === "month" && months.length) {
    monthSelect.value = months[0];
    state.pendingFilters.month = months[0];
  } else {
    monthSelect.value = "";
    state.pendingFilters.month = "";
  }
  syncFilterControls();
}

function render(summary) {
  if (!summary || !summary.totals) { summary = { totals: {}, alerts: [], status: [], operationStatus: [], operationDetails: [], topSku: [], weakSku: [], daily: [], stores: [], runs: [], auditEvents: [], adSpendRows: [], assistant: { score: 0, health: "Menunggu Data", forecast30Omzet: 0, insights: [], actions: [] }, availableStores: [], availableMonths: [] }; }
  const t = summary.totals || {};
  const mode = state.calcMode || "accrual";
  // Use totals directly — settlement/platform/adSettlement come from income_raw now
  const viewGross = Number(t.gross || 0);
  const viewDiscount = Number(t.sellerDiscount || 0);
  const viewOmzet = Number(t.omzet || 0);
  const viewOmzetNet = Math.max(viewGross - viewDiscount, 0);
  const viewSettlement = Number(t.settlement || 0);
  const viewHeld = Number(t.held || 0);
  const viewPlatformFinal = Number(t.platformFeeFinal || 0);
  const viewPlatformEstimated = Number(t.platformFeeEstimated || 0);
  const viewPlatform = viewPlatformFinal + viewPlatformEstimated;
  const viewProfit = Number(t.profit || 0);
  const viewHpp = Number(t.hpp || 0);
  const viewPacking = Number(t.packing || 0);
  const viewHppPacking = viewHpp + viewPacking;
  const viewMargin = viewOmzetNet > 0 ? (viewProfit / viewOmzetNet * 100) : 0;
  const incomeMissing = Number(t.settlement || 0) <= 0;
  const viewOrders = Number(t.orders instanceof Set ? t.orders.size : (t.orders || 0));
  const viewFinalOrders = Number(t.finalOrders instanceof Set ? t.finalOrders.size : (t.finalOrders || 0));
  const viewRefund = Number(t.refund || t.cancelledAmount || 0);
  const viewAdSpend = Number(t.adSpend || 0);
  const viewAdSpendSettlement = Number(t.adSpendSettlement || t.settlementAdSpend || 0);
  const viewAdSpendTopup = Number(t.adSpendTopup || 0);
  const viewRefundOrCancel = Number(t.cancelledAmount || 0);
  const viewCancelledOrders = Number(t.cancelledOrders instanceof Set ? t.cancelledOrders.size : (t.cancelledOrders || 0));
  const viewReturnPkg = Number(t.returnPackages || 0);
  const viewCancelPkg = Number(t.cancelPackages || 0);
  const viewCancelledPkg = Number(t.cancelledPackages || 0);
  const viewAdjustment = Number(t.adjustmentAmount || 0);

  el("generatedAt").textContent = summary.generatedAt;
  el("orders").textContent = num(viewFinalOrders);
  el("todayOrders").textContent = "Final "+num(viewFinalOrders)+" order \u00b7 Retur/cancel "+num(viewCancelledOrders)+" order";
  el("omzet").textContent = fmt(viewGross);
  el("profit").textContent = fmt(viewDiscount);
  el("margin").textContent = "Diskon seller";
  el("finalProfit").textContent = fmt(viewOmzetNet);
  el("finalProfitMeta").textContent = "Omzet setelah diskon seller";
  el("estimatedProfit").textContent = incomeMissing ? "Belum valid" : fmt(viewSettlement);
  el("estimatedProfitMeta").textContent = incomeMissing ? "Income belum match" : "Dari income statement";
  el("held").textContent = fmt(t.pendingSettlementOmzet || 0);
  el("heldMeta").textContent = num(t.pendingSettlementOrders || 0)+" order belum cair";
  el("platformFee").textContent = fmt(viewPlatform);
  const platformFeeMetaEl = document.getElementById("platformFeeMeta");
  if (platformFeeMetaEl) {
    platformFeeMetaEl.textContent = "Final "+fmt(viewPlatformFinal)+" \u00b7 Estimasi "+fmt(viewPlatformEstimated);
  }
  const cancelPackagesEl = document.getElementById("cancelPackages");
  const cancelPackagesMetaEl = document.getElementById("cancelPackagesMeta");
  if (cancelPackagesEl) cancelPackagesEl.textContent = num(viewCancelledPkg);
  if (cancelPackagesMetaEl) {
    cancelPackagesMetaEl.textContent = "Retur "+num(viewReturnPkg)+" \u00b7 Cancel "+num(viewCancelPkg);
  }
  el("adSpend").textContent = fmt(viewAdSpend);
  const adSpendSettlementEl = document.getElementById("adSpendSettlement");
  if (adSpendSettlementEl) adSpendSettlementEl.textContent = fmt(viewAdSpendSettlement);
  const adSpendTopupEl = document.getElementById("adSpendTopup");
  if (adSpendTopupEl) adSpendTopupEl.textContent = fmt(viewAdSpendTopup);
  el("hpp").textContent = fmt(viewHppPacking);
  const hppMetaEl = document.getElementById("hppMeta");
  if (hppMetaEl) hppMetaEl.textContent = "HPP "+fmt(viewHpp)+" \u00b7 Packing "+fmt(viewPacking);
  const bookProfitEl = document.getElementById("bookProfit");
  if (bookProfitEl) bookProfitEl.textContent = fmt(viewProfit);
  const bookProfitMetaEl = document.getElementById("bookProfitMeta");
  if (bookProfitMetaEl) bookProfitMetaEl.textContent = pct(viewMargin)+" margin";

  // Mode label
  const modeLabelEl = document.getElementById("modeLabel");
  if (modeLabelEl) modeLabelEl.textContent = mode === "settlement" ? "Mode Settlement (Cair)" : "Mode Accrual (Real Operasional)";
  renderAlerts(summary.alerts || []);
  renderStatus(summary.status || [], summary.operationStatus || [], summary.operationDetails || []);
  renderTable("topSku", summary.topSku);
  renderTable("weakSku", summary.weakSku);
  renderSkuDetail(summary);
  renderRuns(summary.runs || []);
  renderAuditEvents(summary.auditEvents || []);
  renderAdSpendRows(summary.adSpendRows || []);
  var assistant = summary.assistant || buildAssistantFromTotals(t);
  renderAssistant(assistant);
  renderStores(summary.stores || []);
  drawTrend(summary.daily || []);
  if (summary.availableStores) populateStores(summary.availableStores);
  if (summary.availableMonths) populateMonths(summary.availableMonths);
  
  // Show generated time in quality panel too
  const qualityGen = document.getElementById("qualityGenTime");
  if (qualityGen) qualityGen.textContent = summary.generatedAt || "-";
}

function renderAlerts(alerts) {
  if (!alerts || !alerts.length) { el("alerts").innerHTML = `<div class="alert"><strong>Kondisi normal</strong><div>Belum ada alert besar dari data terakhir.</div></div>`; return; }
  el("alerts").innerHTML = alerts.map(a => `
    <div class="alert ${a.level}">
      <strong>${a.title}</strong>
      <div>${a.body}</div>
    </div>`).join("");
}

function buildAssistantFromTotals(t) {
  var hpp = Number(t.hpp || 0);
  var packing = Number(t.packing || 0);
  var platformFee = Number(t.platformFee || 0);
  var refund = Number(t.refund || t.cancelledAmount || 0);
  var adSpend = Number(t.adSpend || 0);
  var adSpendTopup = Number(t.adSpendTopup || 0);
  var adSpendSettlement = Number(t.adSpendSettlement || t.settlementAdSpend || 0);
  var totalBiaya = hpp + packing + platformFee + refund + adSpendTopup;
  var omzet = Number(t.omzet || 0);
  var gross = Number(t.gross || 0);
  var sellerDiscount = Number(t.sellerDiscount || 0);
  var profit = omzet - platformFee - refund - hpp - packing - adSpendTopup;
  var margin = omzet > 0 ? (profit / omzet * 100) : 0;
  var score = margin >= 30 ? 90 : margin >= 20 ? 75 : margin >= 10 ? 55 : margin >= 0 ? 40 : 20;
  return {
    score: score,
    health: margin >= 25 ? "Sehat" : margin >= 10 ? "Waspada" : "Perlu Perhatian",
    forecast30Omzet: Math.round(omzet),
    forecast30Profit: Math.round(profit),
    insights: ["Data dari split-data API - gunakan mode Accrual untuk perhitungan real operasional."],
    actions: ["Upload data HPP per SKU untuk perhitungan akurat.", "Input biaya iklan untuk profit bersih yang akurat."],
    accounting: {
      omzetKotor: gross,
      diskonSeller: sellerDiscount,
      omzetNet: omzet,
      settlementCair: Number(t.settlement || 0),
      potonganPlatform: platformFee,
      potonganPlatformFinal: Number(t.platformFeeFinal || 0),
      potonganPlatformEstimasi: Number(t.platformFeeEstimated || 0),
      hpp: hpp,
      packing: packing,
      biayaIklan: adSpend,
      biayaIklanSettlement: adSpendSettlement,
      biayaIklanTopup: adSpendTopup,
      totalBiaya: totalBiaya,
      returCancel: refund,
      danaTertahan: Number(t.pendingSettlementOmzet || t.held || 0),
      refund: refund,
      profitBersih: profit,
      hppPacking: hpp + packing
    }
  };
}

function renderAssistant(assistant) {
  if (!assistant) return;
  el("healthScore").textContent = `${assistant.score}/100`;
  el("heroScore").textContent = Math.round(Number(assistant.score || 0));
  el("heroHealth").textContent = assistant.health || "Menunggu Data";
  el("heroForecast").textContent = `Forecast ${fmtCompact(assistant.forecast30Omzet || 0)}`;
  el("heroRing").style.setProperty("--score", Math.max(0, Math.min(100, Number(assistant.score || 0))) + "%");
  el("forecastOmzet").textContent = fmtCompact(assistant.forecast30Omzet);
  el("forecastProfit").textContent = fmtCompact(assistant.forecast30Profit);
  const insights = assistant.insights.map(x => `<li>${x}</li>`).join("");
  const actions = assistant.actions.map(x => `<li>${x}</li>`).join("");
  el("assistant").innerHTML = `
    <div class="health ${assistant.score >= 75 ? "good" : assistant.score >= 55 ? "watch" : "bad"}">
      <span>Status bisnis</span><strong>${assistant.health}</strong>
    </div>
    <h3>Yang saya baca dari data</h3>
    <ul>${insights}</ul>
    <h3>Langkah yang saya sarankan</h3>
    <ul>${actions}</ul>
  `;
  const a = assistant.accounting;
  el("accountingBox").innerHTML = `
    <div><span>Omzet Kotor</span><strong>${fmt(a.omzetKotor ?? a.pendapatan)}</strong></div>
    <div><span>Diskon Seller</span><strong>${fmt(a.diskonSeller || 0)}</strong></div>
    <div><span>Omzet Net</span><strong>${fmt(a.omzetNet ?? a.pendapatan)}</strong></div>
    <div class="secret"><span>Settlement Cair</span><strong>${fmt(a.settlementCair || 0)}</strong></div>
    <div class="secret"><span>Potongan Platform</span><strong>${fmt(a.potonganPlatform)}</strong></div>
    <div class="secret"><span>HPP</span><strong>${fmt(a.hpp || 0)}</strong></div>
    <div class="secret"><span>Packing</span><strong>${fmt(a.packing || 0)}</strong></div>
    <div class="secret"><span>Biaya Iklan Total</span><strong>${fmt(a.biayaIklan)}</strong></div>
    <div class="secret"><span>Iklan Settlement</span><strong>${fmt(a.biayaIklanSettlement || 0)}</strong></div>
    <div class="secret"><span>Iklan Top Up</span><strong>${fmt(a.biayaIklanTopup || 0)}</strong></div>
    <div class="secret"><span>Total HPP + Packing + Iklan</span><strong>${fmt(a.totalBiaya || 0)}</strong></div>
    <div><span>Retur/Cancel</span><strong>${fmt(a.returCancel ?? a.refund)}</strong></div>
    <div><span>Dana Tertahan</span><strong>${fmt(a.danaTertahan || 0)}</strong></div>
    <div class="secret"><span>Profit Bersih</span><strong>${fmt(a.profitBersih ?? a.profitFinal)}</strong></div>
  `;
}

function renderStatus(rows, operationStatus = [], operationDetails = []) {
  const operationCards = document.getElementById("operationCards");
  if (operationCards) {
    const priority = ["late", "processing", "waiting_ship", "waiting_pickup", "shipped", "delivered", "completed", "returned", "canceled", "cancel_valid"];
    const byBucket = new Map(operationStatus.map(row => [row.bucket, row]));
    operationCards.innerHTML = priority.map(bucket => {
      const item = byBucket.get(bucket) || { label: bucket, packages: 0, orders: 0, late: 0 };
      const label = bucket === "late" ? "Terlambat" : item.label;
      const packages = bucket === "late"
        ? operationStatus.reduce((sum, row) => sum + Number(row.late || 0), 0)
        : Number(item.packages || 0);
      const orders = bucket === "late"
        ? operationDetails.filter(row => row.late).length
        : Number(item.orders || 0);
      return `
        <article class="${bucket}">
          <span>${escapeHtml(label)}</span>
          <strong>${num(packages)}</strong>
          <em>${num(orders)} order</em>
        </article>
      `;
    }).join("");
  }
  const operationTable = document.getElementById("operationTable");
  if (operationTable) {
    let details = [...operationDetails];
    if (state.statusFilter === "late") details = details.filter(row => row.late);
    else if (state.statusFilter !== "all") details = details.filter(row => row.bucket === state.statusFilter);
    const sorters = {
      late: (a, b) => Number(b.late) - Number(a.late) || Number(b.ageDays || 0) - Number(a.ageDays || 0),
      age: (a, b) => Number(b.ageDays || 0) - Number(a.ageDays || 0),
      package: (a, b) => Number(b.packageCount || 0) - Number(a.packageCount || 0),
      created: (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    };
    details.sort(sorters[state.statusSort] || sorters.late);
    const body = details.slice(0, 80).map(row => `
      <tr>
        <td><strong>${escapeHtml(row.orderId)}</strong><br><span class="muted">${escapeHtml(row.store)}</span></td>
        <td><span class="badge ${row.late ? "bad" : row.bucket === "completed" ? "good" : "watch"}">${escapeHtml(row.label)}</span></td>
        <td>${num(row.packageCount)}</td>
        <td>${row.late ? `<span class="late-text">${num(row.ageDays)} hari</span>` : `${num(row.ageDays)} hari`}</td>
        <td>${escapeHtml(row.trackingId || "-")}<br><span class="muted">${escapeHtml(row.status || "-")}</span></td>
      </tr>
    `).join("");
    operationTable.innerHTML = `
      <thead><tr><th>Order</th><th>Posisi</th><th>Paket</th><th>Umur</th><th>Resi / Status</th></tr></thead>
      <tbody>${body || `<tr><td colspan="5">Tidak ada paket untuk filter ini.</td></tr>`}</tbody>
    `;
  }
  const max = Math.max(...rows.map(r => r.count), 1);
  el("statusList").innerHTML = rows.slice(0, 8).map(r => `
    <div class="status-row">
      <strong>${r.status}</strong><span>${num(r.count)}</span>
      <div class="bar"><span style="width:${r.count / max * 100}%"></span></div>
    </div>`).join("");
}

function renderStores(rows) {
  el("storeCards").innerHTML = rows.map(r => `
    <article>
      <span>${r.store}</span>
      <strong>${fmt(r.omzet)}</strong>
      <em>${num(r.orders)} order</em>
      <b class="secret">${fmt(r.profit)}</b>
    </article>
  `).join("") || `<p class="hint">Belum ada data untuk toko/periode ini.</p>`;
  const restricted = state.accessRole !== "owner";
  el("storeTable").innerHTML = `
    <tr>
      <th>Toko</th><th>Order</th><th>Omset</th>${restricted ? "" : "<th>Profit</th><th>Margin</th>"}<th>AOV</th>
    </tr>
    ${rows.map(r => {
      const margin = r.omzet ? Number(r.profit || 0) / Number(r.omzet || 1) * 100 : 0;
      const aov = r.orders ? Number(r.omzet || 0) / Number(r.orders || 1) : 0;
      return `<tr>
        <td><strong>${r.store}</strong></td>
        <td>${num(r.orders)}</td>
        <td>${fmt(r.omzet)}</td>
        ${restricted ? "" : `<td>${fmt(r.profit)}</td><td>${margin.toFixed(1)}%</td>`}
        <td>${fmt(aov)}</td>
      </tr>`;
    }).join("")}
  `;
}

function renderTable(id, rows) {
  const restricted = state.accessRole !== "owner";
  const head = restricted
    ? "<tr><th>SKU</th><th>Qty</th><th>Omset</th></tr>"
    : "<tr><th>SKU</th><th>Qty</th><th>Omset</th><th>Profit</th></tr>";
  const body = rows.map(r => restricted
    ? `<tr><td>${r.sku}</td><td>${num(r.qty)}</td><td>${fmt(r.omzet)}</td></tr>`
    : `<tr><td>${r.sku}<small>${r.product ? "<br>" + r.product.slice(0, 66) : ""}</small></td><td>${num(r.qty)}</td><td>${fmt(r.omzet)}</td><td>${fmt(r.profit)}</td></tr>`
  ).join("");
  el(id).innerHTML = head + body;
}

function renderSkuDetail(summary) {
  const s = summary.skuSummary || {};
  el("skuTotal").textContent = num(s.total || 0);
  el("skuGood").textContent = num(s.profitable || 0);
  el("skuBad").textContent = num(s.bad || 0);
  el("skuMissing").textContent = num(s.missingCost || 0);
  const best = s.best ? `${s.best.sku} menghasilkan ${fmt(s.best.profit)} dengan margin ${Number(s.best.margin || 0).toFixed(1)}%.` : "Belum ada SKU penghasil.";
  const weakest = s.weakest ? `${s.weakest.sku} perlu dicek: profit ${fmt(s.weakest.profit)}, margin ${Number(s.weakest.margin || 0).toFixed(1)}%.` : "Belum ada SKU lemah.";
  el("skuInsight").innerHTML = `
    <div><strong>SKU penghasil utama:</strong> ${best}</div>
    <div><strong>SKU kurang bagus:</strong> ${weakest}</div>
  `;
  const rows = [...(summary.skuDetails || [])].filter(row => {
    if (state.skuStatus === "all") return true;
    if (state.skuStatus === "missing") return row.missingCost;
    return row.statusLevel === state.skuStatus;
  });
  const sortKey = state.skuSort;
  rows.sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0));
  if (sortKey === "margin") rows.sort((a, b) => Number(b.margin || 0) - Number(a.margin || 0));
  const body = rows.slice(0, 80).map(row => `
    <tr>
      <td>
        <strong>${row.sku}</strong>
        <small>${row.product ? "<br>" + row.product.slice(0, 84) : ""}</small>
      </td>
      <td><span class="badge ${row.statusLevel}">${row.status}</span></td>
      <td>${num(row.orders)}</td>
      <td>${num(row.qty)}</td>
      <td>${fmt(row.omzet)}</td>
      <td>${fmt(row.profit)}</td>
      <td>${Number(row.margin || 0).toFixed(1)}%</td>
      <td>${fmt(row.hpp + row.packing)}</td>
      <td>${fmt(row.refund)}</td>
      <td>${fmt(row.adSpend)}</td>
    </tr>
  `).join("");
  el("skuDetailTable").innerHTML = `
    <tr>
      <th>SKU</th><th>Status</th><th>Order</th><th>Qty</th><th>Omset</th><th>Profit</th><th>Margin</th><th>HPP+Packing</th><th>Refund</th><th>Iklan</th>
    </tr>
    ${body || `<tr><td colspan="10">Tidak ada SKU untuk filter ini.</td></tr>`}
  `;
}

function renderRuns(rows) {
  el("runs").innerHTML = rows.map(r => `
    <div class="run">
      <strong>${r.kind} · ${r.store_name || "-"} · ${r.filename}</strong><br>
      ${r.rows_seen} baris, ${r.inserted} baru, ${r.updated} berubah, ${r.unchanged || 0} sama<br>
      ${r.audit_count || 0} catatan audit<br>
      ${r.created_at}
    </div>`).join("") || "Belum ada upload.";
}

function renderAuditEvents(rows) {
  const labels = {
    order: "Order baru",
    status: "Status order",
    order_amount: "Total order",
    settlement_received: "Pencairan",
    platform_fee: "Potongan platform",
    refund_amount: "Refund",
    tracking_id: "Resi",
    quantity: "Qty",
  };
  const moneyFields = new Set(["order_amount", "settlement_received", "platform_fee", "refund_amount"]);
  el("auditEvents").innerHTML = rows.slice(0, 30).map(r => {
    const label = labels[r.field_name] || r.field_name;
    const oldValue = moneyFields.has(r.field_name) ? fmt(r.old_value) : (r.old_value || "-");
    const newValue = moneyFields.has(r.field_name) ? fmt(r.new_value) : (r.new_value || "-");
    const type = r.change_type === "inserted" ? "new" : r.field_name === "settlement_received" ? "cash" : "change";
    return `
      <div class="audit-change ${type}">
        <div>
          <strong>${label}</strong>
          <span>${r.store_name} · Order ${r.order_id || "-"} · ${r.sku || "-"}</span>
        </div>
        <p>${oldValue} <b>→</b> ${newValue}</p>
        <em>${r.filename || "-"} · ${r.created_at}</em>
      </div>`;
  }).join("") || `<p class="hint">Belum ada perubahan yang tercatat.</p>`;
}

function renderAdSpendRows(rows) {
  el("adSpendRows").innerHTML = rows.map(r => `
    <div class="run">
      <strong>${r.store_name} · ${r.spend_date} · ${fmt(r.amount)}</strong><br>
      ${r.channel || "Iklan"}${r.campaign ? " · " + r.campaign : ""}<br>
      ${r.note || "Tidak ada catatan"}
    </div>`).join("") || "Belum ada biaya iklan.";
}

function accountingUrl() {
  const params = new URLSearchParams();
  params.set("preset", state.filters.preset === "all" ? "month" : state.filters.preset);
  if (state.filters.preset === "month" && state.filters.month) params.set("month", state.filters.month);
  else if (state.filters.preset === "thisMonth") {
    const now = new Date();
    params.set("month", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  params.set("store", state.filters.store);
  params.set("role", state.accessRole);
  params.set("_", Date.now().toString());
  return "/api/accounting?" + params.toString();
}

async function fetchAccounting() {
  const data = await api(accountingUrl());
  return data;
}

function renderAccounting(summary) {
  const pl = summary.profitLoss || {};
  const bs = summary.balanceSheet || {};
  const cf = summary.cashFlow || {};
  const tx = summary.tax || {};
  const error = summary.error;

  if (error) {
    el("accountingContent").innerHTML = `<div class="alert warn"><strong>Perhatian</strong><div>${escapeHtml(error)}</div></div>`;
    return;
  }

  const storeKeys = Object.keys(pl).filter(k => k !== "total");
  const total = pl.total || {};

  // ── Helper: build a store-column header ──
  function storeHeaders() {
    return storeKeys.map(s => `<th class="store-col">${escapeHtml(s)}</th>`).join("");
  }
  function storeRow(valueFn) {
    return storeKeys.map(s => `<td class="store-col">${fmt(valueFn(pl[s] || {}))}</td>`).join("");
  }

  const html = `
    <div class="accounting-grid">

      <!-- Laba Rugi -->
      <div class="accounting-table-wrap">
        <h3 class="accounting-section-title">Laporan Laba Rugi</h3>
        <table class="accounting-table">
          <thead>
            <tr>
              <th>Uraian</th>
              ${storeHeaders()}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>Omzet (Net)</strong></td>${storeRow(s => s.omzet)}<td><strong>${fmt(total.omzet)}</strong></td></tr>
            <tr><td>HPP</td>${storeRow(s => s.hpp)}<td>${fmt(total.hpp)}</td></tr>
            <tr><td>Biaya Packing</td>${storeRow(s => s.packing)}<td>${fmt(total.packing)}</td></tr>
            <tr><td>Laba Kotor</td>${storeRow(s => s.labaKotor)}<td><strong>${fmt(total.labaKotor)}</strong></td></tr>
            <tr><td>Potongan Platform</td>${storeRow(s => s.platformFee)}<td>${fmt(total.platformFee)}</td></tr>
            <tr><td>Biaya Iklan</td>${storeRow(s => s.adSpend)}<td>${fmt(total.adSpend)}</td></tr>
            <tr class="total-row">
              <td><strong>Laba Bersih</strong></td>
              ${storeRow(s => s.labaBersih)}
              <td><strong>${fmt(total.labaBersih)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Neraca Mini -->
      <div class="accounting-table-wrap">
        <h3 class="accounting-section-title">Neraca Mini</h3>
        <table class="accounting-table">
          <tbody>
            <tr><td><strong>Aset</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Kas (Pencairan)</td><td>${fmt(bs.kas)}</td></tr>
            <tr><td>&nbsp;&nbsp;Piutang Dana Tertahan</td><td>${fmt(bs.piutangDanaTertahan)}</td></tr>
            <tr><td>&nbsp;&nbsp;Persediaan (estimasi)</td><td>${fmt(bs.persediaan)}</td></tr>
            <tr class="total-row"><td><strong>Total Aset</strong></td><td><strong>${fmt(bs.totalAset)}</strong></td></tr>
            <tr><td><strong>Kewajiban & Ekuitas</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Utang Iklan</td><td>${fmt(bs.utangIklan)}</td></tr>
            <tr class="total-row"><td><strong>Ekuitas</strong></td><td><strong>${fmt(bs.ekuitas)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Arus Kas -->
      <div class="accounting-table-wrap">
        <h3 class="accounting-section-title">Arus Kas</h3>
        <table class="accounting-table">
          <tbody>
            <tr><td><strong>Kas Masuk</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Pencairan Settlement</td><td>${fmt(cf.kasMasukPencairan)}</td></tr>
            <tr><td><strong>Kas Keluar</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Pembayaran HPP</td><td>${fmt(cf.kasKeluarHpp)}</td></tr>
            <tr><td>&nbsp;&nbsp;Biaya Packing</td><td>${fmt(cf.kasKeluarPacking)}</td></tr>
            <tr><td>&nbsp;&nbsp;Biaya Iklan</td><td>${fmt(cf.kasKeluarIklan)}</td></tr>
            <tr class="total-row">
              <td><strong>Arus Kas Bersih</strong></td>
              <td><strong>${fmt(cf.arusKasBersih)}</strong></td>
            </tr>
            <tr><td>Dana Tertahan Akhir</td><td>${fmt(cf.danaTertahanAkhir)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Pajak -->
      <div class="accounting-table-wrap">
        <h3 class="accounting-section-title">Pajak</h3>
        <table class="accounting-table">
          <tbody>
            <tr><td><strong>PPh Final PP 23</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Omzet</td><td>${fmt(tx.pphFinalPP23?.omzet || 0)}</td></tr>
            <tr><td>&nbsp;&nbsp;Tarif</td><td>${(Number(tx.pphFinalPP23?.tarif || 0) * 100).toFixed(1)}%</td></tr>
            <tr class="total-row"><td>&nbsp;&nbsp;PPh Terutang</td><td><strong>${fmt(tx.pphFinalPP23?.pphTerutang || 0)}</strong></td></tr>
            <tr><td><strong>PPN</strong></td><td></td></tr>
            <tr><td>&nbsp;&nbsp;Omzet</td><td>${fmt(tx.ppn?.omzet || 0)}</td></tr>
            <tr><td>&nbsp;&nbsp;Tarif</td><td>${(Number(tx.ppn?.tarif || 0) * 100).toFixed(1)}%</td></tr>
            <tr class="total-row"><td>&nbsp;&nbsp;PPN Keluaran</td><td><strong>${fmt(tx.ppn?.ppnKeluaran || 0)}</strong></td></tr>
          </tbody>
        </table>
        <p class="hint">Periode: ${summary.month || "-"} · Generated: ${summary.generatedAt || "-"}</p>
      </div>
    </div>
  `;
  el("accountingContent").innerHTML = html;
}

function drawTrend(rows = []) {
  const canvas = el("trend");
  const statBox = el("trendStats");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const cleanRows = (rows || [])
    .filter(row => row && row.date)
    .map(row => ({
      ...row,
      omzet: Number(row.omzet || 0),
      profit: Number(row.profit || 0),
      orders: Number(row.orders || 0),
    }));
  const ownerView = state.accessRole === "owner";
  const totalOmzet = cleanRows.reduce((sum, row) => sum + row.omzet, 0);
  const totalProfit = cleanRows.reduce((sum, row) => sum + row.profit, 0);
  const totalOrders = cleanRows.reduce((sum, row) => sum + row.orders, 0);
  const avgOmzet = cleanRows.length ? totalOmzet / cleanRows.length : 0;
  const bestDay = cleanRows.reduce((best, row) => row.omzet > (best.omzet || 0) ? row : best, cleanRows[0] || {});
  if (statBox) {
    const cards = [
      ["Omset periode", fmtCompact(totalOmzet), `${cleanRows.length} hari data`],
      ["Rata-rata/hari", fmtCompact(avgOmzet), "Berdasarkan data filter"],
      ["Hari tertinggi", fmtCompact(bestDay.omzet || 0), bestDay.date || "-"],
      ownerView ? ["Profit grafik", fmtCompact(totalProfit), totalOmzet ? `${pct(totalProfit / totalOmzet * 100)} margin` : "Belum ada omzet"] : ["Order grafik", num(totalOrders), "Total order di grafik"],
    ];
    statBox.innerHTML = cards.map(([label, value, meta]) => `
      <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><em>${escapeHtml(meta)}</em></div>
    `).join("");
  }
  ctx.clearRect(0, 0, w, h);
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "#172536");
  grd.addColorStop(1, "#0f141b");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  if (!cleanRows.length) {
    ctx.fillStyle = "#aeb7c6";
    ctx.font = "16px sans-serif";
    ctx.fillText("Belum ada data grafik untuk filter ini.", 42, h / 2);
    return;
  }
  const pad = 54;
  const values = cleanRows.flatMap(row => ownerView ? [row.omzet, row.profit] : [row.omzet]);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const span = Math.max(max - min, 1);
  const x = (i) => pad + (w - pad * 2) * (i / Math.max(cleanRows.length - 1, 1));
  const y = (v) => h - pad - (h - pad * 2) * ((v - min) / span);
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#7f8997";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i < 5; i++) {
    const yy = pad + i * ((h - pad * 2) / 4);
    ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(w - pad, yy); ctx.stroke();
    const value = max - (span * i / 4);
    ctx.fillText(fmtCompact(value).replace("Rp", ""), pad - 8, yy + 4);
  }
  if (min < 0) {
    const zeroY = y(0);
    ctx.strokeStyle = "rgba(216,173,99,.28)";
    ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(w - pad, zeroY); ctx.stroke();
  }
  line("omzet", "#67d3ff");
  if (ownerView) line("profit", "#e7b96d");
  ctx.fillStyle = "#aeb7c6";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Omset", pad, 22);
  if (ownerView) ctx.fillText("Profit", pad + 72, 22);
  ctx.fillStyle = "#7f8997";
  ctx.font = "12px sans-serif";
  const labelIndexes = Array.from(new Set([0, Math.floor((cleanRows.length - 1) / 2), cleanRows.length - 1]));
  labelIndexes.forEach((index) => {
    const row = cleanRows[index];
    if (!row) return;
    const xx = x(index);
    ctx.textAlign = index === 0 ? "left" : index === cleanRows.length - 1 ? "right" : "center";
    ctx.fillText(String(row.date).slice(5), xx, h - 16);
  });
  function line(key, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath();
    cleanRows.forEach((r, i) => i ? ctx.lineTo(x(i), y(r[key])) : ctx.moveTo(x(i), y(r[key])));
    ctx.stroke();
    ctx.fillStyle = color;
    cleanRows.forEach((r, i) => {
      const xx = x(i);
      const yy = y(r[key]);
      ctx.beginPath();
      ctx.arc(xx, yy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

async function loadConfig() {
  const cfg = await api("/api/config");
  state.config = cfg;
  populateStores(cfg.stores || defaultStores);
  // Fill stores textarea
  const ta = document.querySelector("#storesForm textarea");
  if (ta) ta.value = (cfg.stores || defaultStores).join('\n');
  if (!state.folderStore || !(cfg.stores || []).includes(state.folderStore)) state.folderStore = (cfg.stores || defaultStores)[0];
  el("adSpendDate").value = new Date().toISOString().slice(0, 10);
  const form = document.getElementById("configForm");
  for (const [k, v] of Object.entries(cfg)) {
    if (form.elements[k]) form.elements[k].value = v;
  }
  renderFolderMonitor();
}

function currentFolderMonitor() {
  const monitors = (state.config && state.config.folderMonitors) || {};
  return monitors[state.folderStore] || { storeName: state.folderStore, enabled: false, path: "", kind: "auto", intervalMinutes: 10, lastMessage: "Belum berjalan" };
}

function renderFolderMonitor() {
  const folder = currentFolderMonitor();
  const folderForm = document.getElementById("folderForm");
  el("folderStore").value = folder.storeName || state.folderStore;
  for (const [k, v] of Object.entries(folder)) {
    if (!folderForm.elements[k]) continue;
    if (folderForm.elements[k].type === "checkbox") folderForm.elements[k].checked = Boolean(v);
    else folderForm.elements[k].value = v;
  }
  el("folderStatus").textContent = `${folder.enabled ? "Aktif" : "Nonaktif"} · ${folder.lastMessage || "Belum berjalan"}`;
  renderFolderCards((state.config && state.config.folderMonitors) || {});
}

function renderFolderCards(monitors) {
  const rows = Object.values(monitors);
  el("folderCards").innerHTML = rows.map(m => `
    <div class="folder-card ${m.enabled ? "on" : ""}">
      <span>${m.storeName}</span>
      <strong>${m.enabled ? "Aktif" : "Nonaktif"}</strong>
      <p>${m.path || "Folder belum diisi"}</p>
      <em>${m.lastRun ? "Scan terakhir " + m.lastRun : "Belum pernah scan"} · ${m.lastMessage || "Belum berjalan"}</em>
    </div>
  `).join("") || `<p class="hint">Belum ada konfigurasi folder.</p>`;
}

document.querySelectorAll("nav button").forEach(btn => btn.addEventListener("click", () => {
  if (btn.dataset.view === "tv") {
    window.location.href = "/tv";
    return;
  }
  if (btn.dataset.view === "team") {
    window.location.href = "/team";
    return;
  }
  setView(btn.dataset.view);
}));
document.querySelectorAll("[data-preset]").forEach(btn => btn.addEventListener("click", () => {
  state.pendingFilters.preset = btn.dataset.preset;
  if (btn.dataset.preset === "month") {
    state.pendingFilters.month = el("monthFilter").value || (state.summary && state.summary.availableMonths && state.summary.availableMonths[0]) || "";
    if (state.pendingFilters.month) el("monthFilter").value = state.pendingFilters.month;
  } else {
    state.pendingFilters.month = "";
    el("monthFilter").value = "";
  }
  // Show/hide custom date inputs
  var customDiv = document.getElementById("customDateRange");
  if (customDiv) customDiv.style.display = btn.dataset.preset === "custom" ? "flex" : "none";
  syncFilterControls();
  scheduleApplyFilters();
}));
el("monthFilter").addEventListener("change", (event) => {
  state.pendingFilters.month = event.target.value;
  state.pendingFilters.preset = state.pendingFilters.month ? "month" : "thisMonth";
  syncFilterControls();
  scheduleApplyFilters();
});
el("storeFilter").addEventListener("change", (event) => {
  state.pendingFilters.store = event.target.value;
  syncFilterControls();
  scheduleApplyFilters();
});
// Custom date inputs
var startDateEl = document.getElementById("startDateFilter");
var endDateEl = document.getElementById("endDateFilter");
if (startDateEl) startDateEl.addEventListener("change", function() { scheduleApplyFilters(300); });
if (endDateEl) endDateEl.addEventListener("change", function() { scheduleApplyFilters(300); });
el("applyFilters").addEventListener("click", applyFilters);
el("skuSort").addEventListener("change", (event) => {
  state.skuSort = event.target.value;
  if (state.summary) renderSkuDetail(state.summary);
});
el("skuStatus").addEventListener("change", (event) => {
  state.skuStatus = event.target.value;
  if (state.summary) renderSkuDetail(state.summary);
});
el("statusSort").addEventListener("change", (event) => {
  state.statusSort = event.target.value;
  if (state.summary) renderStatus(state.summary.status || [], state.summary.operationStatus || [], state.summary.operationDetails || []);
});
el("statusFilter").addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  if (state.summary) renderStatus(state.summary.status || [], state.summary.operationStatus || [], state.summary.operationDetails || []);
});
el("folderStore").addEventListener("change", (event) => {
  state.folderStore = event.target.value;
  renderFolderMonitor();
});
el("refreshBtn").addEventListener("click", refresh);
el("jumpUploadBtn").addEventListener("click", () => { setView("ops"); el("uploadPanel").scrollIntoView({ behavior: "smooth" }); });

// Mode calculation toggle
document.querySelectorAll("[data-calc-mode]").forEach(function(btn) {
  btn.addEventListener("click", function() {
    state.calcMode = btn.dataset.calcMode;
    document.querySelectorAll("[data-calc-mode]").forEach(function(b) {
      b.classList.toggle("active", b.dataset.calcMode === state.calcMode);
    });
    refresh().catch(function(err) { showNotice(err.message); });
  });
});

// Drilldown close
var drillClose = document.getElementById("closeDrilldown");
if (drillClose) drillClose.addEventListener("click", function() {
  var p = document.getElementById("drilldownPanel");
  if (p) p.style.display = "none";
});

// KPI card drilldown click
document.querySelectorAll(".kpi-card").forEach(function(card) {
  card.style.cursor = "pointer";
  card.addEventListener("click", function() {
    var type = card.dataset.drilldown;
    if (type) openDrilldown(type);
  });
});

function openDrilldown(type, page) {
  if (!state.summary || !state.summary.totals) return;
  page = page || 0;
  var t = state.summary.totals;
  var s = state.summary;
  var panel = document.getElementById("drilldownPanel");
  if (!panel) return;
  panel.style.display = "block";
  
  var info = {title:type,formula:"-",total:"-"};
  var rows = [];
  var columns = [];
  var totalRows = 0;
  var PER_PAGE = 25;
  
  if (type === "orders") {
    info = {title:"Order Selesai",formula:"COUNT DISTINCT order_id WHERE status=Selesai",total:num(t.finalOrders instanceof Set?t.finalOrders.size:(t.finalOrders||0))};
    columns = ["Order ID","Status","Paket","Omzet","Tanggal"];
    var ord = (s.operationDetails||[]).filter(function(r){return r.bucket==="completed";});
    totalRows = ord.length;
    ord = ord.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = ord.map(function(r){return["<strong>"+escapeHtml(r.orderId)+"</strong>","<span class=badge completed>Selesai</span>",num(r.packageCount),fmtExact(r.omzet||0),escapeHtml(r.createdAt||"-")];});
  } else if (type === "omzet") {
    info = {title:"Omzet Kotor",formula:"SUM(Subtotal produk sebelum diskon)",total:fmtExact(t.gross)};
    columns = ["SKU","Qty","Harga/Unit","Subtotal"];
    var skuRows = (s.skuDetails||[]).slice(0,100);
    totalRows = skuRows.length;
    skuRows = skuRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = skuRows.map(function(r){var up = r.qty>0?Math.round(r.omzet/r.qty):0;return[escapeHtml(r.sku),num(r.qty),fmtExact(up),fmtExact(r.omzet)];});
  } else if (type === "discount") {
    info = {title:"Diskon Seller",formula:"SUM(Diskon penjual)",total:fmtExact(t.sellerDiscount)};
    columns = ["SKU","Qty","Total Diskon"];
    var skuRows2 = (s.skuDetails||[]).slice(0,100);
    totalRows = skuRows2.length;
    skuRows2 = skuRows2.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = skuRows2.map(function(r){var disc = Math.round((r.sellerDiscount||0));return[escapeHtml(r.sku),num(r.qty),fmtExact(disc)];});
  } else if (type === "omzetnet") {
    info = {title:"Omzet Net",formula:"Omzet Kotor "+fmtExact(t.gross)+" - Diskon Seller "+fmtExact(t.sellerDiscount),total:fmtExact(t.omzet)};
  } else if (type === "settlement") {
    info = {title:"Settlement Cair",formula:"SUM(Jumlah penyelesaian pembayaran) dari Income Statement, filter: Jenis=Pesanan, Waktu Pemesanan="+s.filters.startDate+" s/d "+s.filters.endDate, total:fmtExact(t.settlement)};
    columns = ["Order ID (Pesanan)","Tanggal Pemesanan","Settlement","Biaya Platform"];
    // Fetch settlement details from operationDetails that have settlement
    var settRows = (s.operationDetails||[]).filter(function(r){return r.bucket==="completed";}).slice(0,200);
    totalRows = settRows.length;
    settRows = settRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = settRows.map(function(r){return["<strong>"+escapeHtml(r.orderId)+"</strong>",escapeHtml(r.createdAt||"-"),fmtExact(r.omzet||0),"(lihat income)"];});
    if (rows.length === 0) {
      rows = [["(Data settlement diambil dari Income Statement)","Filter: Jenis=Pesanan, "+s.filters.startDate+".."+s.filters.endDate,"Total: "+fmtExact(t.settlement),"Biaya: "+fmtExact(t.platformFee)]];
    }
  } else if (type === "held") {
    const pendingCount = t.pendingSettlementOrders || 0;
    const pendingOmzet = t.pendingSettlementOmzet || 0;
    info = {title:"Dana Tertahan",formula:pendingCount+" order Selesai/Dikirim belum cair = "+fmtExact(pendingOmzet),total:fmtExact(pendingOmzet)};
    if (pendingCount > 0) {
      columns = ["Order ID","Status","Omzet","Tracking","Paket"];
      var pendingRows = (s.operationDetails||[]).filter(function(r){return r.pendingSettlement===true;});
      totalRows = pendingRows.length;
      pendingRows = pendingRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
      rows = pendingRows.map(function(r){return["<strong>"+escapeHtml(r.orderId)+"</strong>","<span class=badge>"+escapeHtml(r.status||"-")+"</span>",fmt(r.omzet||0),escapeHtml(r.trackingId||"-"),num(r.packageCount)];});
    }
  } else if (type === "platform") {
    info = {title:"Potongan Platform",formula:"ABS(SUM(Total Biaya)) dari Income Statement, filter: Jenis=Pesanan, Waktu Pemesanan="+s.filters.startDate+" s/d "+s.filters.endDate, total:fmtExact(t.platformFee)};
    columns = ["Sumber Data","Jenis Transaksi","Periode","Total Biaya"];
    rows = [["Income Statement (finance_income_raw)","Pesanan",s.filters.startDate+" s/d "+s.filters.endDate,fmtExact(t.platformFee)]];
  } else if (type === "cancel") {
    info = {title:"Paket Retur/Cancel",formula:"Retur: "+num(t.returnPackages||0)+" paket | Cancel: "+num(t.cancelPackages||0)+" paket | Total: "+num(t.cancelledPackages||0),total:num(t.cancelledPackages||0)};
    columns = ["Order ID","Tipe","Status","Cancel Reason","Tracking","Paket"];
    var cancelRows = (s.operationDetails||[]).filter(function(r){return r.bucket==="canceled"||r.bucket==="returned";});
    totalRows = cancelRows.length;
    cancelRows = cancelRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = cancelRows.map(function(r){return["<strong>"+escapeHtml(r.orderId)+"</strong>","<span class=badge "+r.bucket+">"+escapeHtml(r.label)+"</span>",escapeHtml(r.status||"-"),escapeHtml(r.cancelReason||"-"),escapeHtml(r.trackingId||"-"),num(r.packageCount)];});
  } else if (type === "adspend" || type === "adspendsettlement" || type === "adspendtopup") {
    var allAdRows = (s.adSpendRows||[]);
    var adRows;
    if (type === "adspendsettlement") {
      adRows = allAdRows.filter(function(r){return (r.channel||"").toLowerCase().indexOf("gmv")>=0;});
      info = {title:"Iklan Settlement/GMV",formula:"Dari Income Statement: Jenis=Pembayaran GMV untuk Iklan TikTok, Waktu Pemesanan="+s.filters.startDate+" s/d "+s.filters.endDate, total:fmtExact(t.adSpendSettlement||t.settlementAdSpend)};
    } else if (type === "adspendtopup") {
      adRows = allAdRows.filter(function(r){return (r.channel||"").toLowerCase().indexOf("top up")>=0;});
      info = {title:"Iklan Top Up",formula:"SUM(amount) WHERE channel=TikTok Top Up",total:fmtExact(t.adSpendTopup)};
    } else {
      adRows = allAdRows;
      info = {title:"Biaya Iklan Total",formula:"GMV "+fmtExact(t.adSpendSettlement)+" + Top Up "+fmtExact(t.adSpendTopup),total:fmtExact(t.adSpend)};
    }
    columns = ["Toko","Tanggal","Jumlah","Channel","Campaign"];
    totalRows = adRows.length;
    adRows = adRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = adRows.map(function(r){return[escapeHtml(r.store_name||""),escapeHtml(r.spend_date||""),fmtExact(r.amount),escapeHtml(r.channel||""),escapeHtml(r.campaign||"")];});
    // If no GMV ad rows in adSpendRows, show from summary totals
    if (type === "adspendsettlement" && rows.length === 0) {
      rows = [["(Data dari Income Statement)","Jenis: Pembayaran GMV untuk Iklan TikTok","Periode: "+s.filters.startDate+".."+s.filters.endDate,"Total: "+fmtExact(t.adSpendSettlement||t.settlementAdSpend),""]];
    }
  } else if (type === "hpp") {
    info = {title:"HPP + Packing",formula:"HPP = SUM(Qty x HPP per unit). Packing = COUNT DISTINCT(Tracking>Package>Order) x Rp2.000",total:fmtExact((Number(t.hpp||0)+Number(t.packing||0)))};
    columns = ["SKU","Qty","HPP/Unit","Total HPP","Status"];
    var hppRows = (s.skuDetails||[]).filter(function(r){return r.hpp>0||r.qty>0;});
    totalRows = hppRows.length;
    hppRows = hppRows.slice(page*PER_PAGE, (page+1)*PER_PAGE);
    rows = hppRows.map(function(r){var templateHpp = r.unitHpp || (r.qtyCost>0?Math.round(r.hpp/r.qtyCost):0);return[escapeHtml(r.sku),num(r.qty)+" (cost: "+num(r.qtyCost||0)+")",fmtExact(templateHpp),fmtExact(r.hpp||0),r.missingCost?"⚠️ Belum dipetakan":"✅"];});
  } else if (type === "profitbersih") {
    var base = t.settlement||0;
    var pengg = t.adjustmentAmount||0;
    var hp = (t.hpp||0)+(t.packing||0);
    var iklan = (t.adSpendTopup||0)+(t.adSpendSettlement||0);
    info = {title:"Profit Bersih",formula:"Settlement "+fmtExact(base)+" + Penggantian "+fmtExact(pengg)+" - HPP+Packing "+fmtExact(hp)+" - Iklan "+fmtExact(iklan)+" = "+fmtExact(t.profit),total:fmtExact(t.profit)};
  }
  
  document.getElementById("drilldownTitle").textContent = info.title;
  document.getElementById("drilldownFormula").textContent = info.formula;
  document.getElementById("drilldownTotal").textContent = "Total: " + info.total;
  
  var tableHtml = "";
  if (rows.length && columns.length) {
    var th = columns.map(function(c){return"<th>"+escapeHtml(c)+"</th>";}).join("");
    var tb = rows.map(function(r){return"<tr>"+r.map(function(c){return"<td>"+c+"</td>";}).join("")+"</tr>";}).join("");
    tableHtml = "<thead><tr>"+th+"</tr></thead><tbody>"+(tb||"<tr><td colspan="+columns.length+">Tidak ada data</td></tr>")+"</tbody>";
  } else {
    tableHtml = "<tbody><tr><td colspan=5 style=padding:16px;text-align:center;color:#94a3b8;>"+info.formula+"<br><strong>Total: "+info.total+"</strong></td></tr></tbody>";
  }
  
  // Pagination
  var totalPages = Math.ceil(totalRows / PER_PAGE);
  var paginationHtml = "";
  if (totalPages > 1) {
    paginationHtml = "<div class=drilldown-pagination id=drilldownPages>";
    for (var p = 0; p < Math.min(totalPages, 20); p++) {
      paginationHtml += "<button data-drilldown-page="+p+" class="+(p===page?"active":"")+">"+(p+1)+"</button>";
    }
    if (totalPages > 20) paginationHtml += "<span>..."+totalPages+" halaman</span>";
    paginationHtml += "<span style=margin-left:8px;color:#94a3b8;>"+totalRows+" baris total</span></div>";
  }
  
  document.getElementById("drilldownTable").innerHTML = tableHtml;
  document.getElementById("drilldownPagination").innerHTML = paginationHtml;
  
  // Store current drilldown type for pagination
  state._drilldownType = type;
  
  // Re-attach pagination event listeners
  var pageButtons = document.querySelectorAll("#drilldownPages button");
  for (var i = 0; i < pageButtons.length; i++) {
    pageButtons[i].addEventListener("click", function() {
      var p = parseInt(this.getAttribute("data-drilldown-page"));
      if (!isNaN(p)) openDrilldown(state._drilldownType, p);
    });
  }
  
  panel.scrollIntoView({behavior:"smooth"});
}
el("sampleBtn").addEventListener("click", async () => {
  if (isCloudPreview) {
    showNotice("Di Vercel kita pakai data real dari upload, bukan data contoh. Pilih Upload Data lalu masukkan file SKU, order, atau pencairan.");
    return;
  }
  const storeName = el("uploadStore").value || "ventura";
  try {
    await api("/api/import-samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName }) });
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  let uploadResults = [];
  try {
    if (isCloudPreview) {
      if (!window.CloudFinance) throw new Error("Mode upload online belum siap. Refresh halaman Vercel lalu coba lagi.");
      uploadResults = await window.CloudFinance.uploadForm(event.target, api, showNotice);
    } else {
      const fd = new FormData(event.target);
      uploadResults = [await api("/api/upload", { method: "POST", body: fd })];
    }
    el("fileInput").value = "";
    setView("owner");
    
    // Show detailed upload result
    const flat = (uploadResults||[]).flatMap(item => item && item.results ? item.results : [item]).filter(Boolean);
    let detailMsg = '';
    for (const r of flat) {
      const kindLabel = {orders:'Orders',income:'Income',sku:'SKU HPP',ads:'Iklan'}[r.kind]||r.kind||'Data';
      detailMsg += `${kindLabel}: ${r.rows||0} baris diproses`;
      if (r.inserted) detailMsg += `, ${r.inserted} baru`;
      if (r.updated) detailMsg += `, ${r.updated} diperbarui`;
      if (r.adSpendRows) detailMsg += `, ${r.adSpendRows} iklan GMV (Rp${Math.round(r.adSpendTotal||0).toLocaleString('id-ID')})`;
      if (r.unmatchedOrders) detailMsg += `, ${r.unmatchedOrders} tidak match`;
      detailMsg += '. ';
    }
    const adRows = flat.reduce((sum, item) => sum + Number(item.adSpendRows || 0), 0);
    const adTotal = flat.reduce((sum, item) => sum + Number(item.adSpendTotal || 0), 0);
    const adText = adRows ? ` Iklan GMV settlement terdeteksi ${adRows} transaksi (Rp${Math.round(adTotal).toLocaleString('id-ID')}).` : "";
    showNotice((detailMsg || "Upload selesai.") + adText, "info");
    
    // Refresh to show latest data
    setTimeout(refresh, 500);
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("folderForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (cloudBlocked("Auto update folder")) return;
  const data = Object.fromEntries(new FormData(event.target).entries());
  data.enabled = event.target.elements.enabled.checked;
  state.folderStore = data.storeName || state.folderStore;
  try {
    await api("/api/folder-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await loadConfig();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("adSpendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/api/ad-spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    event.target.elements.amount.value = "";
    event.target.elements.campaign.value = "";
    event.target.elements.note.value = "";
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
el("folderRun").addEventListener("click", async () => {
  if (cloudBlocked("Scan folder")) return;
  try {
    const result = await api("/api/folder-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName: el("folderStore").value }) });
    el("folderStatus").textContent = result.message;
    await loadConfig();
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
el("folderRunAll").addEventListener("click", async () => {
  if (cloudBlocked("Scan semua toko")) return;
  try {
    const result = await api("/api/folder-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName: "all" }) });
    el("folderStatus").textContent = result.message;
    await loadConfig();
    await refresh();
  } catch (err) {
    showNotice(err.message);
  }
});
document.getElementById("configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    alert("Pengaturan Telegram disimpan.");
  } catch (err) {
    showNotice(err.message);
  }
});

// Stores form
document.getElementById("storesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = event.target.elements.stores.value;
  const stores = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  try {
    await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stores }) });
    alert("Daftar toko disimpan: " + stores.join(", "));
    await loadConfig();
  } catch (err) {
    showNotice(err.message);
  }
});
el("telegramTest").addEventListener("click", async () => {
  try {
    await api("/api/telegram-test", { method: "POST" });
    alert("Ringkasan tes dikirim ke Telegram.");
  } catch (err) {
    showNotice(err.message);
  }
});

// ===== Data Quality Center =====
async function loadDataQuality() {
  const params = new URLSearchParams();
  params.set("preset", state.filters.preset);
  if (state.filters.preset === "month" && state.filters.month) params.set("month", state.filters.month);
  params.set("store", state.filters.store);
  params.set("role", state.accessRole);
  params.set("_", Date.now().toString());
  const data = await api("/api/data-quality?" + params.toString());
  renderDataQuality(data);
}

function renderDataQuality(data) {
  const scoreEl = document.getElementById("qualityScore");
  if (scoreEl) {
    const skor = data.skorKualitas || 0;
    let cls = "good";
    if (skor < 50) cls = "waspada";
    else if (skor < 75) cls = "sedang";
    scoreEl.className = "quality-score " + cls;
    scoreEl.textContent = "Skor: " + skor + "/100 · " + (data.statusKeseluruhan || "-").charAt(0).toUpperCase() + (data.statusKeseluruhan || "-").slice(1);
  }

  const overview = document.getElementById("qualityOverview");
  if (overview) {
    overview.innerHTML = [
      '<div class="quality-stat"><span>SKU Tanpa HPP</span><strong class="' + (data.skuTanpaHpp.length > 0 ? 'stat-bad' : 'stat-ok') + '">' + data.skuTanpaHpp.length.toLocaleString("id-ID") + '</strong></div>',
      '<div class="quality-stat"><span>Order Selesai Belum Cair</span><strong class="' + (data.orderTanpaPencairan.length > 0 ? 'stat-bad' : 'stat-ok') + '">' + data.orderTanpaPencairan.length.toLocaleString("id-ID") + '</strong></div>',
      '<div class="quality-stat"><span>Pencairan Tanpa Order</span><strong class="' + (data.pencairanTanpaOrder.length > 0 ? 'stat-warn' : 'stat-ok') + '">' + data.pencairanTanpaOrder.length.toLocaleString("id-ID") + '</strong></div>',
      '<div class="quality-stat"><span>Cancel/Refund Besar</span><strong class="' + (data.cancelRefundBesar.filter(c => c.total >= 50000).length > 0 ? 'stat-bad' : 'stat-ok') + '">' + data.cancelRefundBesar.length.toLocaleString("id-ID") + '</strong></div>',
      '<div class="quality-stat"><span>Data Duplikat</span><strong class="' + (data.dataDuplikat.length > 0 ? 'stat-warn' : 'stat-ok') + '">' + data.dataDuplikat.length.toLocaleString("id-ID") + '</strong></div>',
    ].join("");
  }

  function fmtRp(n) { return "Rp" + Math.round(Number(n || 0)).toLocaleString("id-ID"); }

  // Paginated table with "Load More"
  const PAGE_SIZE = 25;
  const paginators = {};
  function initP(tid, rows) { if (!paginators[tid]) paginators[tid] = { offset: 0, rows: rows || [] }; }
  
  function renderTable(tid, cols) {
    const el = document.getElementById(tid);
    if (!el) return;
    const p = paginators[tid];
    if (!p || !p.rows || p.rows.length === 0) {
      el.innerHTML = '<tbody><tr><td colspan="' + cols.length + '" style="text-align:center;padding:20px;color:#94a3b8;">Tidak ada masalah untuk kategori ini ✅</td></tr></tbody>';
      return;
    }
    const chunk = p.rows.slice(0, p.offset + PAGE_SIZE);
    const hasMore = p.offset + PAGE_SIZE < p.rows.length;
    const head = '<thead><tr>' + cols.map(c => '<th>' + c.header + '</th>').join("") + '</tr></thead>';
    const body = chunk.map(r => '<tr>' + cols.map(c => '<td>' + (c.fmt ? c.fmt(r[c.key]) : escapeHtml(String(r[c.key] || ""))) + '</td>').join("") + '</tr>').join("");
    let foot = "";
    if (hasMore) {
      const rem = p.rows.length - (p.offset + PAGE_SIZE);
      foot = '<tr><td colspan="' + cols.length + '" style="text-align:center;padding:10px;"><button class="qlm" data-t="' + tid + '" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:7px 20px;cursor:pointer;font-size:0.85rem;">Tampilkan lebih banyak (+' + Math.min(PAGE_SIZE, rem) + " dari " + rem + ")</button></td></tr>";
    }
    el.innerHTML = head + '<tbody>' + body + foot + '</tbody>';
  }

  // Bind load-more clicks
  setTimeout(function() {
    document.querySelectorAll(".qlm").forEach(function(b) {
      b.addEventListener("click", function() {
        var t = this.dataset.t;
        if (paginators[t]) {
          paginators[t].offset += PAGE_SIZE;
          renderTable(t, tableCols[t]);
        }
        this.remove();
      });
    });
  }, 50);

  var tableCols = {
    qualitySkuTanpaHpp: [
      { header: "SKU", key: "sku" }, { header: "Toko", key: "store" },
      { header: "Produk", key: "product" },
      { header: "Qty", key: "qtyTotal", fmt: function(n) { return Number(n || 0).toLocaleString("id-ID"); } },
      { header: "Omset", key: "omzetTotal", fmt: fmtRp },
    ],
    qualityOrderBelumCair: [
      { header: "Order ID", key: "orderId" }, { header: "Toko", key: "store" },
      { header: "SKU", key: "sku" }, { header: "Total", key: "total", fmt: fmtRp },
      { header: "Dibuat", key: "created" }, { header: "Umur", key: "ageDays", fmt: function(n) { return String(n || 0) + " hr"; } },
    ],
    qualitySettlementTanpaOrder: [
      { header: "Order ID", key: "orderId" }, { header: "Toko", key: "store" },
      { header: "SKU", key: "sku" }, { header: "Amount", key: "amount", fmt: fmtRp },
      { header: "Sumber", key: "source" },
    ],
    qualityCancelRefund: [
      { header: "Order ID", key: "orderId" }, { header: "Toko", key: "store" },
      { header: "SKU", key: "sku" }, { header: "Total", key: "total", fmt: fmtRp },
      { header: "Status", key: "status" }, { header: "Dibuat", key: "created" },
    ],
    qualityDuplikat: [
      { header: "Line Key", key: "lineKey" }, { header: "Order ID", key: "orderId" },
      { header: "Toko", key: "store" }, { header: "SKU", key: "sku" },
      { header: "Duplikat", key: "count", fmt: function(n) { return String(n || 0) + "x"; } },
      { header: "Nilai Total", key: "totalValues", fmt: fmtRp },
    ],
  };

  for (var tid in tableCols) {
    var dk = tid === "qualitySkuTanpaHpp" ? "skuTanpaHpp"
      : tid === "qualityOrderBelumCair" ? "orderTanpaPencairan"
      : tid === "qualitySettlementTanpaOrder" ? "pencairanTanpaOrder"
      : tid === "qualityCancelRefund" ? "cancelRefundBesar"
      : "dataDuplikat";
    initP(tid, data[dk] || []);
    renderTable(tid, tableCols[tid]);
  }

  const saranEl = document.getElementById("qualitySaran");
  if (saranEl) {
    if (data.saran && data.saran.length > 0) {
      saranEl.innerHTML = '<ul>' + data.saran.map(function(s) { return "<li>" + escapeHtml(s) + "</li>"; }).join("") + "</ul>";
    } else {
      saranEl.innerHTML = '<p style="padding:14px;color:#94a3b8;">Data dalam kondisi baik, tidak ada saran perbaikan saat ini ✅</p>';
    }
  }
}
// Modify refresh to also load quality data if that view is active
// refresh() handles quality view inline

// Inject skeleton loading CSS
(function() {
  if (document.getElementById("hermes-skeleton-css")) return;
  const style = document.createElement("style");
  style.id = "hermes-skeleton-css";
  style.textContent = ".skeleton{background:linear-gradient(90deg,var(--card-bg,#1e293b) 25%,var(--border,#334155) 50%,var(--card-bg,#1e293b) 75%);background-size:200% 100%;animation:skeleton-pulse 1.5s ease-in-out infinite;border-radius:8px;min-height:20px}.skeleton-card{min-height:80px;margin:8px 0}@keyframes skeleton-pulse{0%{background-position:200% 0}100%{background-position:-200% 0}}";
  document.head.appendChild(style);
})();

syncFilterControls();
setView(state.view);
loadConfig().then(refresh).catch(err => alert(err.message));

// Emergency filter populate — ensures dropdowns work even if render() didn't fill them
setTimeout(function() {
  var mf = document.getElementById("monthFilter");
  var sf = document.getElementById("storeFilter");
  if (mf && mf.options.length <= 1) {
    var now = new Date();
    var html = '<option value="">Semua bulan</option>';
    for (var i = 0; i < 12; i++) {
      var y = now.getFullYear();
      var m = String(now.getMonth() + 1).padStart(2, "0");
      html += '<option value="' + y + "-" + m + '">' + monthLabel(y + "-" + m) + "</option>";
      now.setMonth(now.getMonth() - 1);
    }
    mf.innerHTML = html;
    console.log("[hermes] Emergency filter populated");
  }
  if (sf && sf.options.length <= 1) {
    sf.innerHTML = '<option value="all">Semua Toko</option>' +
      defaultStores.map(function(s) { return '<option value="' + s + '">' + s + "</option>"; }).join("");
    console.log("[hermes] Emergency stores populated");
  }
}, 3000);

setInterval(async () => {
  await refresh();
  if (state.view === "ops") await loadConfig();
}, 60000);
