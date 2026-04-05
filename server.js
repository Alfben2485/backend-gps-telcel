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
// 🔥 CICLO DE FACTURACIÓN (28 → ayer)
// =========================
function getDateRange() {
  const now = new Date();
  let start;

  // Día de inicio: 28 del mes actual o del anterior
  if (now.getDate() >= 28) {
    start = new Date(now.getFullYear(), now.getMonth(), 28);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 28);
  }

  // Fecha final: ayer (para evitar fechas futuras)
  const end = new Date(now);
  end.setDate(now.getDate() - 1);

  const format = (d) => d.toISOString().split("T")[0];
  return { start: format(start), end: format(end) };
}

// =========================
// 🧠 CACHE (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
// 🔥 FUNCIÓN PARA OBTENER EL entAccount.id DEL DISPOSITIVO
// =========================
let cachedAccountId = null;
let cachedAccountIdImsi = null;

async function getDeviceAccountId(request, imsi) {
  if (cachedAccountIdImsi === imsi && cachedAccountId && Date.now() - cachedAccountId.time < CACHE_TIME) {
    return cachedAccountId.id;
  }

  try {
    const res = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: { imsis: imsi }
    });
    
    const device = res.data?.devices?.find(d => d.imsi === imsi);
    if (device && device.entAccount && device.entAccount.id) {
      const accountId = device.entAccount.id;
      console.log(`📌 Account ID (entAccount.id) obtenido para IMSI ${imsi}: ${accountId}`);
      cachedAccountId = { id: accountId, time: Date.now() };
      cachedAccountIdImsi = imsi;
      return accountId;
    } else {
      console.log(`⚠️ No se encontró entAccount.id para IMSI ${imsi}.`);
      return null;
    }
  } catch (err) {
    console.error(`❌ Error al obtener entAccount.id: ${err.message}`);
    return null;
  }
}

// =========================
// 🔥 CONSUMO REAL (prioriza /sim/Data/Usage, fallback día por día)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché para IMSI ${imsi} → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const { start, end } = getDateRange();
  console.log(`📅 Período facturación (real): ${start} → ${end}`);

  const accountId = await getDeviceAccountId(request, imsi);
  if (!accountId) {
    console.log(`❌ No se pudo obtener accountId, usando método día por día.`);
    return await fetchUsageDayByDay(request, imsi, start, end);
  }
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

    if (!usageCache.has(imsi)) {
      console.log("📦 Respuesta de /sim/Data/Usage:", JSON.stringify(res.data, null, 2));
    }

    const items = res.data?.object || [];
    let totalKB = 0;
    for (const item of items) {
      if (item.servedImsi === imsi) {
        totalKB += parseFloat(item.totalBytesInKb || 0);
      }
    }
    totalMB = totalKB / 1024;
    if (totalMB > 0) {
      console.log(`✅ /sim/Data/Usage → ${totalMB.toFixed(3)} MB`);
    } else {
      console.log(`⚠️ /sim/Data/Usage devolvió 0 MB, usando método día por día.`);
      return await fetchUsageDayByDay(request, imsi, start, end);
    }
  } catch (err) {
    console.error(`❌ Error en /sim/Data/Usage: ${err.message}`);
    console.log(`🔄 Cambiando a método día por día...`);
    return await fetchUsageDayByDay(request, imsi, start, end);
  }

  const result = { consumoMB: Number(totalMB.toFixed(3)) };
  usageCache.set(imsi, { time: Date.now(), data: result });
  console.log(`🎯 CONSUMO TOTAL FINAL: ${result.consumoMB} MB`);
  return result;
}

// =========================
// 🔥 MÉTODO DÍA POR DÍA (FALLBACK) - usando fechas hasta hoy
// =========================
async function fetchUsageDayByDay(request, imsi, start, end) {
  console.log(`📆 Usando método día por día desde ${start} hasta ${end}`);

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
        request({
          method: "post",
          url: `${BASE_URL}/gcapi/simUplink/usage`,
          data: { imsi, startDate: date, endDate: date }
        }).catch(() => null),
        request({
          method: "post",
          url: `${BASE_URL}/gcapi/simDownlink/usage`,
          data: { imsi, startDate: date, endDate: date }
        }).catch(() => null)
      ])
    );
    for (const res of results) {
      if (res && res.data && res.data.object) {
        for (const day of res.data.object) {
          const mb = day["totalBytes(MB)"] ?? day["totalbytes(MB)"] ?? 0;
          totalMB += Number(mb);
        }
      }
    }
  }

  console.log(`📊 Método día por día → ${totalMB.toFixed(3)} MB`);
  return { consumoMB: Number(totalMB.toFixed(3)) };
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
  console.log("🚀 SERVER DEFINITIVO - CONSUMO REAL DESDE 28 HASTA AYER");
  console.log("📅 Rango de fechas: 28 del período → ayer");
  console.log("🔧 Fallback automático a día por día si falla el endpoint principal");
});
