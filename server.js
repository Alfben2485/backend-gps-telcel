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
// 🔥 CICLO DE FACTURACIÓN REAL (28 → 27)
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
// 🧠 CACHE PARA CONSUMO (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
// 🔥 CONSUMO DEFINITIVO USANDO /consumed/usage (el que sí da el total real)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  // Verificar caché
  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché para IMSI ${imsi} → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const { start, end } = getDateRange();
  console.log(`📅 Período facturación: ${start} → ${end}`);

  // Convertir fechas a objetos Date para generar chunks de 3 días
  let startDate = new Date(start);
  let endDate = new Date(end);
  let totalMB = 0;

  // Generar chunks de máximo 3 días
  let chunkStart = new Date(startDate);
  while (chunkStart <= endDate) {
    let chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 2); // 3 días (inclusive)
    if (chunkEnd > endDate) chunkEnd = new Date(endDate);

    const fromDateTime = `${chunkStart.toISOString().split("T")[0]} 00:00:00`;
    const toDateTime = `${chunkEnd.toISOString().split("T")[0]} 23:59:59`;

    console.log(`🔄 Consultando chunk: ${fromDateTime} → ${toDateTime}`);

    try {
      const response = await request({
        method: "post",
        url: `${BASE_URL}/gcapi/consumed/usage`,
        data: {
          imsis: imsi,
          startTime: fromDateTime,
          stopTime: toDateTime,
          offset: "0",
          limit: "1",
        },
        timeout: 10000, // 10 segundos por chunk
      });

      // La respuesta tiene: usage.data.dataTotalUsage (en MB)
      const chunkMB = parseFloat(response.data?.usage?.data?.dataTotalUsage || 0);
      if (!isNaN(chunkMB) && chunkMB > 0) {
        console.log(`   ✅ +${chunkMB.toFixed(3)} MB`);
        totalMB += chunkMB;
      } else {
        console.log(`   ⚠️ 0 MB en este chunk`);
      }
    } catch (err) {
      console.error(`   ❌ Error en chunk: ${err.message}`);
    }

    // Avanzar al siguiente chunk (día siguiente al final del chunk actual)
    chunkStart.setDate(chunkEnd.getDate() + 1);
  }

  const result = { consumoMB: Number(totalMB.toFixed(3)) };
  usageCache.set(imsi, { time: Date.now(), data: result });
  console.log(`🎯 CONSUMO TOTAL REAL: ${result.consumoMB} MB`);
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
// 🔥 ENDPOINTS + RESET (sin cambios)
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
  console.log("🚀 SERVER CON CONSUMO REAL VÍA /consumed/usage");
  console.log("📅 Ciclo de facturación: 28 → 27 (estándar Claro)");
  console.log("🔍 Revisa la consola para ver los MB obtenidos por chunk");
});
