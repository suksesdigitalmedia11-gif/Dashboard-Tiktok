/**
 * API: Product Profitability
 * GET /api/product-profitability?store=custombase&month=2026-07&mode=accrual
 */
const { json, buildFilters, computeProductProfitability, requireOwner, safeLog } = require("../lib/finance-cloud");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  try {
    const query = req.query || {};
    const role = query.role || "owner";
    if (role === "owner" && !(await requireOwner(req, res))) return;

    const filters = buildFilters({ preset: query.preset || "month", month: query.month, store: query.store || "custombase", mode: query.mode || "accrual" });
    const result = await computeProductProfitability(filters);
    
    return json(res, 200, result);
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message });
  }
};
