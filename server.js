const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

const agent = new https.Agent({
  rejectUnauthorized: false,
});

const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// =========================
// 🔥 CUENTA ORIGINAL
// =========================
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";

let TOKEN = null;
let TOKEN_TIME = 0;

// =========================
// 🔥 CUENTAS EXTRA
// =========================
const ACCOUNTS_EXTRA = {
  cuenta2: {
    username: "alfben2",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
  cuenta3: {
    username: "alfben4",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
};

const TOKEN_DURATION = 50 * 60 * 1000;

// =========================
// 🔐 TOKEN ORIGINAL
// =========================
async function getToken() {
  const r = await axios({
    httpsAgent: agent,
    method: "post",
    url: `${BASE_URL}/gcapi/auth`,
    data: { username: USERNAME, password: PASSWORD },
  });

  TOKEN = r.data?.token;
  TOKEN_TIME = Date.now();
  console.log("🔑 Token actualizado");
}

async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}

// =========================
// 🔐 TOKEN EXTRA
// =========================
async function ensureTokenExtra(key) {
  const acc = ACCOUNTS_EXTRA[key];

  if (!acc.token || Date.now() - acc.tokenTime > TOKEN_DURATION) {
    const r = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: {
        username: acc.username,
        password: acc.password,
      },
    });

    acc.token = r.data?.token;
    acc.tokenTime = Date.now();
    console.log(`🔑 Token extra (${key}) actualizado`);
  }
}

// =========================
// 🔥 REQUEST
// =========================
async function claroRequest(config) {
  await ensureToken();

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

async function claroRequestExtra(key, config) {
  await ensureTokenExtra(key);

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${ACCOUNTS_EXTRA[key].token}`,
      "Content-Type": "application/json",
    },
  });
}

// =========================
// 🔹 FUNCIONES GENERALES
// =========================
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// =========================
// 🔥 CONVERSIÓN A FECHA LOCAL (CDMX, UTC-6)
// =========================
function toLocalDate(date) {
  const offset = 6; // UTC-6 para CDMX
  const local = new Date(date.getTime() - offset * 60 * 60 * 1000);
  return local.toISOString().split("T")[0];
}

// =========================
// 🔥 CICLO DE FACTURACIÓN (28 → ayer, en hora local)
// =========================
function getDateRange() {
  const now = new Date();
  // Ajustar a UTC-6 para que el corte de día coincida con CDMX
  const localNow = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  
  let start;
  if (localNow.getUTCDate() >= 28) {
    start = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 28));
  } else {
    start = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - 1, 28));
  }
  
  const end = new Date(localNow);
  end.setUTCDate(localNow.getUTCDate() - 1); // ayer
  
  const format = (d) => d.toISOString().split("T")[0];
  return { start: format(start), end: format(end) };
}

// =========================
// 🧠 CACHE (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
// 🔥 CONSUMO COMBINADO (uplink+downlink+sessionHistory+bundleDetails)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché para IMSI ${imsi} → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const { start, end } = getDateRange();
  console.log(`📅 Período facturación (hora local CDMX): ${start} → ${end}`);

  const dates = [];
  let current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  let totalMB = 0;
  const BATCH_SIZE = 6;

  // 1. Uplink + Downlink día por día
  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.flatMap(date => [
        request({ method: "post", url: `${BASE_URL}/gcapi/simUplink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null),
        request({ method: "post", url: `${BASE_URL}/gcapi/simDownlink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null)
      ])
    );
    for (const res of results) {
      if (res && res.data && res.data.object) {
        for (const day of res.data.object) {
          totalMB += Number(day["totalBytes(MB)"] ?? day["totalbytes(MB)"] ?? 0);
        }
      }
    }
  }

  // 2. Session History
  try {
    const sessionRes = await request({ method: "post", url: `${BASE_URL}/gcapi/device/sessionHistory`, data: { imsi, startDate: start, endDate: end } });
    const sessions = sessionRes.data?.data || [];
    let sessionMB = 0;
    for (const s of sessions) sessionMB += Number(s.totalBytes || 0) / (1024 * 1024);
    if (sessionMB > 0) {
      console.log(`➕ SessionHistory añade: ${sessionMB.toFixed(3)} MB`);
      totalMB += sessionMB;
    }
  } catch (err) { console.log("⚠️ sessionHistory falló"); }

  // 3. Bundle Details
  try {
    const bundleRes = await request({ method: "post", url: `${BASE_URL}/gcapi/sim/bundleDetails`, data: { imsis: imsi } });
    const bundleMB = parseFloat(bundleRes.data?.data || 0);
    if (bundleMB > 0) {
      console.log(`➕ BundleDetails añade: ${bundleMB.toFixed(3)} MB`);
      totalMB += bundleMB;
    }
  } catch (err) { console.log("⚠️ bundleDetails falló"); }

  const result = { consumoMB: Number(totalMB.toFixed(3)) };
  usageCache.set(imsi, { time: Date.now(), data: result });
  console.log(`🎯 Consumo final calculado: ${result.consumoMB} MB`);
  return result;
}

// =========================
// 🔥 CORE (sin cambios)
// =========================
async function fetchSim(request, value) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/device/list`, data: { start: 0, length: 10, search: { value } } });
  const items = r.data?.data || [];
  return items.find(i => String(i.iccid).trim() === String(value).trim() || String(i.msisdn).trim() === String(value).trim());
}

async function getSimExtra(request, sim) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/get/sims`, data: { msisdn: sim.msisdn } });
  const device = (r.data?.devices || []).find(d => String(d.iccid) === String(sim.iccid));
  return { imsi: device?.imsi, plan: device?.devicePlans?.planName || "N/A" };
}

async function getTotalSims(request) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/device/list`, data: { start: 0, length: 1 } });
  return r.data?.recordsFiltered || 0;
}

// =========================
// 🔥 ENDPOINTS
// =========================
function buildEndpoint(path, requestFn) {
  app.get(path, async (req, res) => {
    const timeout = setTimeout(() => res.json({ ok: false, error: "Timeout" }), 25000);
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) { clearTimeout(timeout); return res.json({ ok: false, error: "SIM no encontrada" }); }
      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);
      const [consumo, totalSims] = await Promise.all([fetchUsage(requestFn, imsi), getTotalSims(requestFn)]);
      clearTimeout(timeout);
      res.json({ ok: true, totalSims, iccid: sim.iccid, msisdn: sim.msisdn, estado: sim.state, plan: extra.plan, consumoMB: consumo.consumoMB });
    } catch (error) {
      clearTimeout(timeout);
      console.error("Error en endpoint:", error.message);
      res.json({ ok: false, error: error.message });
    }
  });
}

function buildReset(path, requestFn) {
  app.post(path, async (req, res) => {
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) return res.json({ ok: false, error: "SIM no encontrada" });
      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);
      const r = await requestFn({ method: "post", url: `${BASE_URL}/gcapi/sim/reset`, data: { imsi } });
      res.json({ ok: true, data: r.data });
    } catch (error) {
      console.error("Error reset:", error.message);
      res.json({ ok: false, error: error.message });
    }
  });
}

buildEndpoint("/api/device/full/:value", claroRequest);
buildEndpoint("/api2/device/full/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildEndpoint("/api3/device/full/:value", (cfg) => claroRequestExtra("cuenta3", cfg));

buildReset("/api/device/reset/:value", claroRequest);
buildReset("/api2/device/reset/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildReset("/api3/device/reset/:value", (cfg) => claroRequestExtra("cuenta3", cfg));

// =========================
// 🚀 START
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SERVER CON ZONA HORARIA CDMX (UTC-6) Y MÚLTIPLES FUENTES");
});
