// Health check endpoint
const { json } = require("../lib/finance-cloud");
const pg = require("../lib/pg-connector");

const startTime = Date.now();

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method tidak didukung." });
  
  let dbStatus = "OK";
  try {
    await pg.pgQuery("SELECT 1", []);
  } catch (e) {
    dbStatus = "ERROR: " + e.message;
  }
  
  return json(res, 200, {
    status: dbStatus === "OK" ? "OK" : "DEGRADED",
    database: dbStatus,
    calculationVersion: "2.0.0",
    serverTime: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    store: process.env.STORE || "all",
    port: process.env.PORT || 9876,
  });
};
