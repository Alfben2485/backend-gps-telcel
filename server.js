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

// 🔐 CREDENCIALES
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";

// 🧠 TOKEN GLOBAL
let TOKEN = null;
let TOKEN_TIME = 0;
const TOKEN_DURATION = 50 * 60 * 1000; // 50 min

// 🔥 OBTENER TOKEN
async function getToken() {
  try {
    const response = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: {
        username: USERNAME,
        password: PASSWORD,
      },
    });

    TOKEN = response.data?.token;
    TOKEN_TIME = Date.now();

    console.log("🔐 NUEVO TOKEN GENERADO");

    return TOKEN;

  } catch (e) {
    console.log("❌ ERROR TOKEN:", e.message);
    return null;
  }
}

// 🔥 VERIFICAR TOKEN
async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔥 REQUEST CON AUTO-RETRY
async function claroRequest(config) {
  await ensureToken();

  let response = await axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...claroHeaders(),
      ...(config.headers || {}),
    },
  });

  // 🔥 SI TOKEN EXPIRÓ → REINTENTA
  if (response.status === 401 || response.data?.error === "Unauthorized") {
    console.log("♻️ TOKEN EXPIRADO, RENOVANDO...");

    await getToken();

    response = await axios({
      httpsAgent: agent,
      timeout: 15000,
      validateStatus: () => true,
      ...config,
      headers: {
        ...claroHeaders(),
        ...(config.headers || {}),
      },
    });
  }

  return response;
}

// 🔹 TOTAL SIMS
async function getTotalSims() {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { start: 0, length: 1 },
    });

    return r.data?.recordsFiltered || 0;
  } catch {
    return 0;
  }
}

// 🔹 IMSI
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔍 BUSCAR SIM
async function fetchSim(value) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 10,
        search: { value },
      },
    });

    const items = response.data?.data || [];

    return items.find(
      (item) =>
        String(item.iccid).trim() === String(value).trim() ||
        String(item.msisdn).trim() === String(value).trim()
    );

  } catch {
    return null;
  }
}

// 🔥 PLAN + IMSI
async function getSimExtraData(sim) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: {
        msisdn: sim.msisdn,
      },
    });

    const device = (r.data?.devices || []).find(
      (d) => String(d.iccid) === String(sim.iccid)
    );

    if (!device) return {};

    return {
      imsi: device.imsi,
      plan: device.devicePlans?.planName || "N/A",
    };

  } catch {
    return {};
  }
}

// 🔥 CONSUMO (simple pero estable)
async function fetchUsage(imsi) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: { imsi },
    });

    const total =
      Number(r.data?.data?.totalMB) ||
      Number(r.data?.data?.totalBytes) / (1024 * 1024) ||
      0;

    return { consumoMB: Number(total.toFixed(3)) };

  } catch {
    return { consumoMB: 0 };
  }
}

// 🔍 API PRINCIPAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtraData(sim);

    const imsi = extra.imsi || extractIMSI(sim);

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(imsi),
      getTotalSims(),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state,
      plan: extra.plan || "N/A",
      consumoMB: consumo.consumoMB,
    });

  } catch (e) {
    res.json({ ok: false });
  }
});

// 🔁 RESET (NO SE ROMPE)
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtraData(sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi },
    });

    res.json({ ok: true, data: r.data });

  } catch {
    res.json({ ok: false });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SERVER CON TOKEN AUTO");
});
