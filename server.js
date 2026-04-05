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
// 🔥 OBTENER ACCOUNT ID DEL USUARIO AUTENTICADO
// =========================
let cachedAccountId = null;

async function getAccountId(request) {
  if (cachedAccountId) return cachedAccountId;
  try {
    // Obtener información del usuario desde el token
    const res = await request({
      method: "get",
      url: `${BASE_URL}/gcapi/users`,
      params: { start: 0, size: 1 },
    });
    const users = res.data?.users;
    if (users && users.length > 0 && users[0].account && users[0].account.id) {
      cachedAccountId = users[0].account.id;
      console.log(`📌 Account ID obtenido: ${cachedAccountId}`);
      return cachedAccountId;
    }
    // Fallback: intentar con el endpoint de account (podrías tener un ID conocido)
    const accountRes = await request({
      method: "get",
      url: `${BASE_URL}/gcapi/account/1`, // Prueba con ID 1
    });
    if (accountRes.data && accountRes.data.id) {
      cachedAccountId = accountRes.data.id;
      console.log(`📌 Account ID por fallback: ${cachedAccountId}`);
      return cachedAccountId;
    }
  } catch (err) {
    console.log("⚠️ No se pudo obtener Account ID automáticamente, usando valor por defecto 12");
  }
  cachedAccountId = 12; // Valor por defecto (puede ser el de tu cuenta)
  return cachedAccountId;
}

// =========================
// 🧠 CACHE PARA CONSUMO (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
// 🔥 CONSUMO REAL USANDO /gcapi/sim/Data/Usage
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché para IMSI ${imsi} → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const { start, end } = getDateRange();
  console.log(`📅 Período facturación: ${start} → ${end}`);

  const accountId = await getAccountId(request);
  console.log(`🏢 Usando Account ID: ${accountId}`);

  let totalMB = 0;

  // MÉTODO PRINCIPAL: /gcapi/sim/Data/Usage
  try {
    const res = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: {
        startDate: start,
        endDate: end,
        offset: 0,
        limit: 100,
        imsi: imsi,
        accountId: accountId,
      },
      timeout: 15000,
    });

    console.log("📦 Respuesta completa de /sim/Data/Usage:", JSON.stringify(res.data, null, 2));

    const items = res.data?.object || [];
    let totalKB = 0;
    for (const item of items) {
      if (item.servedImsi === imsi) {
        totalKB += parseFloat(item.totalBytesInKb || 0);
      }
    }
    const mbFromDataUsage = totalKB / 1024;
    if (mbFromDataUsage > 0) {
      console.log(`✅ /sim/Data/Usage → ${mbFromDataUsage.toFixed(3)} MB`);
      totalMB = mbFromDataUsage;
    } else {
      console.log(`⚠️ /sim/Data/Usage devolvió 0 MB, intentando método alternativo...`);
    }
  } catch (err) {
    console.error(`❌ Error en /sim/Data/Usage: ${err.message}`);
  }

  // MÉTODO ALTERNATIVO: /gcapi/consumed/usage (si el principal falla)
  if (totalMB === 0) {
    try {
      const fromDateTime = `${start} 00:00:00`;
      const toDateTime = `${end} 23:59:59`;
      const res = await request({
        method: "post",
        url: `${BASE_URL}/gcapi/consumed/usage`,
        data: {
          imsis: imsi,
          startTime: fromDateTime,
          stopTime: toDateTime,
          offset: "0",
          limit: "1",
        },
        timeout: 15000,
      });
      const dataUsage = res.data?.usage?.data?.dataTotalUsage || 0;
      const mbFromConsumed = parseFloat(dataUsage);
      if (mbFromConsumed > 0) {
        console.log(`✅ /consumed/usage → ${mbFromConsumed.toFixed(3)} MB`);
        totalMB = mbFromConsumed;
      }
    } catch (err) {
      console.error(`❌ Error en /consumed/usage: ${err.message}`);
    }
  }

  // MÉTODO DE RESERVA: /gcapi/device/dataUsage (en bytes)
  if (totalMB === 0) {
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
      const mbFromBytes = bytes / (1024 * 1024);
      if (mbFromBytes > 0) {
        console.log(`✅ /device/dataUsage → ${mbFromBytes.toFixed(3)} MB`);
        totalMB = mbFromBytes;
      }
    } catch (err) {
      console.error(`❌ Error en /device/dataUsage: ${err.message}`);
    }
  }

  const result = { consumoMB: Number(totalMB.toFixed(3)) };
  usageCache.set(imsi, { time: Date.now(), data: result });
  console.log(`🎯 CONSUMO TOTAL FINAL: ${result.consumoMB} MB`);
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
    const timeout = setTimeout(() => res.json({ ok: false, error: "Timeout" }), 25000);
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) {
        clearTimeout(timeout);
        return res.json({ ok: false, error: "SIM no encontrada" });
      }

      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);

      const [consumo, totalSims] = await Promise.all([
        fetchUsage(requestFn, imsi),
        getTotalSims(requestFn),
      ]);

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

      const r = await requestFn({
        method: "post",
        url: `${BASE_URL}/gcapi/sim/reset`,
        data: { imsi },
      });

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
  console.log("🚀 SERVER DEFINITIVO - USANDO /sim/Data/Usage CON ACCOUNT ID AUTOMÁTICO");
  console.log("📅 Ciclo facturación: 28 → 27");
  console.log("🔍 Revisa la consola para ver la respuesta completa de la API");
});
