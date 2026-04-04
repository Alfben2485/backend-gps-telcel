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

// 🔑 TOKEN
let TOKEN = null;
let TOKEN_TIME = 0;
const TOKEN_DURATION = 50 * 60 * 1000;

// 🔥 CACHE
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// 🔥 TOKEN
async function getToken() {
  try {
    const r = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: {
        username: USERNAME,
        password: PASSWORD,
      },
    });

    TOKEN = r.data?.token;
    TOKEN_TIME = Date.now();

    console.log("🔐 TOKEN OK");
  } catch (e) {
    console.log("❌ TOKEN ERROR:", e.message);
  }
}

async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔥 REQUEST BASE
async function claroRequest(config) {
  await ensureToken();

  let r = await axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...headers(),
      ...(config.headers || {}),
    },
  });

  if (r.status === 401) {
    await getToken();

    r = await axios({
      httpsAgent: agent,
      timeout: 15000,
      validateStatus: () => true,
      ...config,
      headers: {
        ...headers(),
        ...(config.headers || {}),
      },
    });
  }

  return r;
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
    const r = await claroRequest({
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
      data: { msisdn: sim.msisdn },
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

// 🔥 CONSUMO ESTABLE Y RÁPIDO
async function fetchUsage(imsi) {
  try {
    if (!imsi) return { consumoMB: 0 };

    // 🔥 CACHE
    const cached = usageCache.get(imsi);
    if (cached && Date.now() - cached.time < CACHE_TIME) {
      return cached.data;
    }

    const now = new Date();

    let start, end;

    if (now.getDate() >= 27) {
      start = new Date(now.getFullYear(), now.getMonth(), 27);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 25);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 27);
      end = new Date(now.getFullYear(), now.getMonth(), 25);
    }

    const format = (d) => d.toISOString().split("T")[0];

    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(format(new Date(d)));
    }

    let total = 0;

    // 🔥 EJECUTAR EN BLOQUES (más rápido sin romper API)
    const chunkSize = 5;

    for (let i = 0; i < dates.length; i += chunkSize) {
      const chunk = dates.slice(i, i + chunkSize);

      const requests = chunk.map((date) =>
        Promise.all([
          claroRequest({
            method: "post",
            url: `${BASE_URL}/gcapi/simUplink/usage`,
            data: { imsi, startDate: date, endDate: date },
          }).catch(() => null),

          claroRequest({
            method: "post",
            url: `${BASE_URL}/gcapi/simDownlink/usage`,
            data: { imsi, startDate: date, endDate: date },
          }).catch(() => null),
        ])
      );

      const results = await Promise.all(requests);

      for (const [up, down] of results) {
        (up?.data?.object || []).forEach(
          (i) => (total += Number(i["totalBytes(MB)"] || 0))
        );

        (down?.data?.object || []).forEach(
          (i) => (total += Number(i["totalBytes(MB)"] || 0))
        );
      }
    }

    // 🔥 SESSION ACTIVA
    try {
      const r = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/device/sessionHistory`,
        data: {
          imsi,
          startDate: format(start),
          endDate: format(end),
        },
      });

      (r.data?.data || []).forEach(
        (s) => (total += Number(s.totalBytes || 0) / (1024 * 1024))
      );

    } catch {}

    const result = { consumoMB: Number(total.toFixed(3)) };

    usageCache.set(imsi, {
      time: Date.now(),
      data: result,
    });

    return result;

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
  }
}

// 🔍 ENDPOINT PRINCIPAL
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

  } catch {
    res.json({ ok: false });
  }
});

// 🔁 RESET (INTACTO)
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
  console.log("🚀 SERVER ESTABLE + RÁPIDO + FUNCIONANDO");
});
