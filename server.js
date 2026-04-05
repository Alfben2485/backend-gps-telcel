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
  }
}

// =========================
// 🔥 REQUEST (con validateStatus)
// =========================
async function claroRequest(config) {
  await ensureToken();

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(config.headers || {}),
    },
  });
}

async function claroRequestExtra(key, config) {
  await ensureTokenExtra(key);

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: {
      Authorization: `Bearer ${ACCOUNTS_EXTRA[key].token}`,
      "Content-Type": "application/json",
      ...(config.headers || {}),
    },
  });
}

// =========================
// 🧠 CACHE (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

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
// 🔥 CICLO DE FACTURACIÓN (AJUSTABLE)
// Prueba con 28 y 27 primero (debe dar 13.628 MB)
// Si no, cambia a 27 y 25 (como tu código antiguo) o 28 y 26.
// =========================
function getDateRange() {
  const now = new Date();
  let start, end;

  // 👇 CAMBIA ESTOS DOS NÚMEROS SEGÚN LO QUE COINCIDA CON LA PLATAFORMA
  const CORTE_INICIO = 28;   // día de inicio del ciclo
  const CORTE_FIN = 27;      // último día del ciclo

  if (now.getDate() >= CORTE_INICIO) {
    start = new Date(now.getFullYear(), now.getMonth(), CORTE_INICIO);
    end = new Date(now.getFullYear(), now.getMonth() + 1, CORTE_FIN);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, CORTE_INICIO);
    end = new Date(now.getFullYear(), now.getMonth(), CORTE_FIN);
  }

  const format = (d) => d.toISOString().split("T")[0];
  return { start: format(start), end: format(end) };
}

// =========================
// 🔥 CONSUMO OPTIMIZADO (chunks de 7 días, rápido)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  // Caché
  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const { start, end } = getDateRange();

  // Generar rangos de 7 días
  const ranges = [];
  let currentStart = new Date(start);
  const endDate = new Date(end);

  while (currentStart <= endDate) {
    let currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + 6); // 7 días
    if (currentEnd > endDate) currentEnd = new Date(endDate);
    ranges.push({
      start: currentStart.toISOString().split("T")[0],
      end: currentEnd.toISOString().split("T")[0]
    });
    currentStart.setDate(currentStart.getDate() + 7);
  }

  let totalMB = 0;

  // Procesar rangos en paralelo (máximo 3 a la vez)
  const chunkSize = 3;
  for (let i = 0; i < ranges.length; i += chunkSize) {
    const chunk = ranges.slice(i, i + chunkSize);
    const promises = chunk.flatMap(range => [
      request({
        method: "post",
        url: `${BASE_URL}/gcapi/simUplink/usage`,
        data: { imsi, startDate: range.start, endDate: range.end }
      }).catch(() => null),
      request({
        method: "post",
        url: `${BASE_URL}/gcapi/simDownlink/usage`,
        data: { imsi, startDate: range.start, endDate: range.end }
      }).catch(() => null)
    ]);

    const results = await Promise.all(promises);
    for (const res of results) {
      if (res && res.data && res.data.object) {
        for (const day of res.data.object) {
          const mb = day["totalBytes(MB)"] ?? day["totalbytes(MB)"] ?? 0;
          totalMB += Number(mb);
        }
      }
    }
  }

  // Agregar sessionHistory (una sola llamada)
  try {
    const sessionRes = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/device/sessionHistory`,
      data: { imsi, startDate: start, endDate: end }
    });
    const sessions = sessionRes.data?.data || [];
    for (const s of sessions) {
      totalMB += Number(s.totalBytes || 0) / (1024 * 1024);
    }
  } catch (err) {
    // No crítico
  }

  const result = { consumoMB: Number(totalMB.toFixed(3)) };
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
    data: {
      start: 0,
      length: 10,
      search: { value },
    },
  });

  const items = r.data?.data || [];

  return items.find(
    (i) =>
      String(i.iccid).trim() === String(value).trim() ||
      String(i.msisdn).trim() === String(value).trim()
  );
}

async function getSimExtra(request, sim) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { msisdn: sim.msisdn },
  });

  const device = (r.data?.devices || []).find(
    (d) => String(d.iccid) === String(sim.iccid)
  );

  return {
    imsi: device?.imsi,
    plan: device?.devicePlans?.planName || "N/A",
  };
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
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) return res.json({ ok: false });

      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);

      const [consumo, totalSims] = await Promise.all([
        fetchUsage(requestFn, imsi),
        getTotalSims(requestFn),
      ]);

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
      console.error("Error en endpoint:", error.message);
      res.json({ ok: false });
    }
  });
}

function buildReset(path, requestFn) {
  app.post(path, async (req, res) => {
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) return res.json({ ok: false });

      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);

      const r = await requestFn({
        method: "post",
        url: `${BASE_URL}/gcapi/sim/reset`,
        data: { imsi },
      });

      res.json({ ok: true, data: r.data });
    } catch (error) {
      console.error("Error en reset:", error.message);
      res.json({ ok: false });
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
  console.log("🚀 SERVER OPTIMIZADO - RÁPIDO Y PRECISO");
});
