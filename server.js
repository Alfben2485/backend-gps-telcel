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

// 🔥 CICLO ORIGINAL (28 → 26) - SIN CAMBIOS
function getDateRange() {
  const now = new Date();

  let start, end;

  if (now.getDate() >= 27) {
    start = new Date(now.getFullYear(), now.getMonth(), 28);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 26);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 28);
    end = new Date(now.getFullYear(), now.getMonth(), 26);
  }

  const format = (d) => d.toISOString().split("T")[0];

  return { start: format(start), end: format(end) };
}

// =========================
// 🔥 CONSUMO CORREGIDO (con timeout y endpoint confiable)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const { start, end } = getDateRange();

  // Formato de fecha requerido por /device/dataUsage: "YYYY-MM-DD HH:MM"
  const fromDate = `${start} 00:00`;
  const toDate = `${end} 23:59`;

  // Timeout de 30 segundos para toda la operación
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), 30000)
  );

  const fetchPromise = (async () => {
    try {
      const response = await request({
        method: "get",
        url: `${BASE_URL}/gcapi/device/dataUsage`,
        params: {
          imsi: imsi,
          fromDate: fromDate,
          toDate: toDate,
        },
      });

      // El campo totalUsage viene en bytes
      const totalBytes = response.data?.totalUsage || 0;
      const totalMB = totalBytes / (1024 * 1024);
      return { consumoMB: Number(totalMB.toFixed(3)) };
    } catch (err) {
      console.error("Error en device/dataUsage:", err.message);
      return { consumoMB: 0 };
    }
  })();

  try {
    const resultado = await Promise.race([fetchPromise, timeoutPromise]);
    return resultado;
  } catch (error) {
    console.error("fetchUsage timeout o error:", error.message);
    return { consumoMB: 0 };
  }
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
  console.log("🚀 SERVER 100% FUNCIONAL");
});
