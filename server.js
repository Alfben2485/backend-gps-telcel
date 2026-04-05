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

// ============================================================
// 🔥 CONFIGURACIÓN DE AUTENTICACIÓN
// ============================================================
// Opción 1: Usar token fijo (el que funcionaba en tu código antiguo)
// Descomenta las siguientes líneas y comenta la autenticación dinámica si quieres probar con token fijo.
// const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc1MjQzNzc3NjI2LCJ1c2VySWQiOjU3M30.RMrthfrWTUjwKkWJR6fB5gZyJDVFgYJnIomTi_bc9qinjO7nuciP_f7Bc76mJ5LpgDaugAMKdI8xo6YZe7NV_g";
// let TOKEN_TIME = Date.now();

// Opción 2: Autenticación dinámica (la que venías usando)
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";
let TOKEN = null;
let TOKEN_TIME = 0;

const TOKEN_DURATION = 50 * 60 * 1000;

// =========================
// 🔐 TOKEN ORIGINAL (dinámico)
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
  console.log("🔑 Token dinámico actualizado");
}

async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}

// =========================
// 🔥 CUENTAS EXTRA (sin cambios)
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

async function ensureTokenExtra(key) {
  const acc = ACCOUNTS_EXTRA[key];
  if (!acc.token || Date.now() - acc.tokenTime > TOKEN_DURATION) {
    const r = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: { username: acc.username, password: acc.password },
    });
    acc.token = r.data?.token;
    acc.tokenTime = Date.now();
    console.log(`🔑 Token extra (${key}) actualizado`);
  }
}

// =========================
// 🔥 REQUEST (usa token dinámico o fijo según configuración)
// =========================
async function claroRequest(config) {
  // Si estás usando token fijo, comenta la siguiente línea
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
  return item.imsi || item.subscription?.imsi || item.sim?.imsi || item.deviceInfo?.imsi || null;
}

// =========================
// 🔥 CICLO DE FACTURACIÓN (28 → 27)
// =========================
function getDateRange() {
  const now = new Date();
  let start, end;
  if (now.getDate() >= 28) {
    start = new Date(now.getFullYear(), now.getMonth(), 28);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 27);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 28);
    end = new Date(now.getFullYear(), now.getMonth(), 27);
  }
  const format = (d) => d.toISOString().split("T")[0];
  return { start: format(start), end: format(end) };
}

// =========================
// 🧠 CACHE (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
// 🔥 CONSUMO INTELIGENTE (múltiples métodos, toma el máximo)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const { start, end } = getDateRange();
  console.log(`📅 Período: ${start} → ${end}`);

  let resultados = [];

  // Método 1: /gcapi/device/dataUsage (total en bytes)
  try {
    const fromDate = `${start} 00:00`;
    const toDate = `${end} 23:59`;
    const res = await request({
      method: "get",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      params: { imsi, fromDate, toDate },
      timeout: 10000,
    });
    const bytes = res.data?.totalUsage || 0;
    const mb = bytes / (1024 * 1024);
    console.log(`📡 device/dataUsage → ${mb.toFixed(3)} MB`);
    resultados.push(mb);
  } catch (err) {
    console.log(`⚠️ device/dataUsage falló: ${err.message}`);
  }

  // Método 2: /gcapi/sim/Data/Usage (consolidado en KB) - MÁS CONFIABLE
  try {
    const res = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: {
        startDate: start,
        endDate: end,
        offset: 0,
        limit: 100,
        accountId: 12,  // Puede que necesites el accountId correcto, pruébalo con 12 o déjalo vacío
        imsi: imsi
      },
      timeout: 10000,
    });
    const items = res.data?.object || [];
    let totalKB = 0;
    for (const item of items) {
      if (item.servedImsi === imsi) {
        totalKB += parseFloat(item.totalBytesInKb || 0);
      }
    }
    const mb = totalKB / 1024;
    console.log(`📡 sim/Data/Usage → ${mb.toFixed(3)} MB`);
    resultados.push(mb);
  } catch (err) {
    console.log(`⚠️ sim/Data/Usage falló: ${err.message}`);
  }

  // Método 3: Día por día (uplink+downlink) como respaldo
  try {
    const dates = [];
    let current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    let totalMB = 0;
    const BATCH_SIZE = 6;
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
      const batch = dates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.flatMap(date => [
          request({ method: "post", url: `${BASE_URL}/gcapi/simUplink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null),
          request({ method: "post", url: `${BASE_URL}/gcapi/simDownlink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null)
        ])
      );
      for (const res of results) {
        if (res?.data?.object) {
          for (const day of res.data.object) {
            totalMB += Number(day["totalBytes(MB)"] || 0);
          }
        }
      }
    }
    console.log(`📡 Día por día → ${totalMB.toFixed(3)} MB`);
    resultados.push(totalMB);
  } catch (err) {
    console.log(`⚠️ Día por día falló: ${err.message}`);
  }

  // Método 4: bundleDetails (consumo actual del plan)
  try {
    const res = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/bundleDetails`,
      data: { imsis: imsi },
      timeout: 5000,
    });
    const mb = parseFloat(res.data?.data || 0);
    console.log(`📡 bundleDetails → ${mb.toFixed(3)} MB`);
    resultados.push(mb);
  } catch (err) {
    console.log(`⚠️ bundleDetails falló: ${err.message}`);
  }

  // Método 5: sessionHistory (sesiones activas)
  try {
    const res = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/device/sessionHistory`,
      data: { imsi, startDate: start, endDate: end },
      timeout: 10000,
    });
    const sessions = res.data?.data || [];
    let totalBytes = 0;
    for (const s of sessions) totalBytes += Number(s.totalBytes || 0);
    const mb = totalBytes / (1024 * 1024);
    console.log(`📡 sessionHistory → ${mb.toFixed(3)} MB`);
    resultados.push(mb);
  } catch (err) {
    console.log(`⚠️ sessionHistory falló: ${err.message}`);
  }

  // Tomamos el valor más alto entre todos los métodos (para no perder nada)
  const consumoMB = Math.max(...resultados, 0);
  const final = Number(consumoMB.toFixed(3));
  console.log(`🎯 CONSUMO FINAL (máximo): ${final} MB`);

  const result = { consumoMB: final };
  usageCache.set(imsi, { time: Date.now(), data: result });
  return result;
}

// =========================
// 🔥 CORE (sin cambios)
// =========================
async function fetchSim(request, value) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: { start: 0, length: 10, search: { value } },
  });
  const items = r.data?.data || [];
  return items.find(
    (i) => String(i.iccid).trim() === String(value).trim() || String(i.msisdn).trim() === String(value).trim()
  );
}

async function getSimExtra(request, sim) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { msisdn: sim.msisdn },
  });
  const device = (r.data?.devices || []).find(d => String(d.iccid) === String(sim.iccid));
  return { imsi: device?.imsi, plan: device?.devicePlans?.planName || "N/A" };
}

async function getTotalSims(request) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: { start: 0, length: 1 },
  });
  return r.data?.recordsFiltered || 0;
}

// =========================
// 🔥 ENDPOINTS + RESET
// =========================
function buildEndpoint(path, requestFn) {
  app.get(path, async (req, res) => {
    const timeout = setTimeout(() => res.json({ ok: false, error: "Timeout" }), 20000);
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) { clearTimeout(timeout); return res.json({ ok: false, error: "SIM no encontrada" }); }
      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);
      const [consumo, totalSims] = await Promise.all([fetchUsage(requestFn, imsi), getTotalSims(requestFn)]);
      clearTimeout(timeout);
      res.json({
        ok: true,
        totalSims,
        iccid: sim.iccid,
        msisdn: sim.msisdn,
        estado: sim.state,
        plan: extra.plan,
        consumoMB: consumo.consumoMB,
      });
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
      console.error("Error en reset:", error.message);
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
  console.log("🚀 SERVER DEFINITIVO - MÚLTIPLES MÉTODOS DE CONSUMO");
  console.log("📅 Ciclo de facturación: 28 → 27");
  console.log("🔍 Se probarán 5 métodos y se usará el valor más alto.");
  console.log("💡 Si aún da 0, prueba usando el TOKEN FIJO (descomenta línea 43 y comenta autenticación dinámica)");
});
