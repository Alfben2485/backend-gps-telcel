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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0OTgyNzgzNTI4LCJ1c2VySWQiOjU3M30.kGtW9zgJ4MmL1B4QCYYDGGjpCLfVU-IqT9nBPhYDEjgUsaCAaIDlZWeQcQDa5xHRzGt_GiZoq_zO5xX-QsyxDg";

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 REQUEST BASE (rápido)
async function claroRequest(config) {
  return axios({
    httpsAgent: agent,
    timeout: 10000, // 🔥 rápido
    validateStatus: () => true,
    ...config,
    headers: {
      ...claroHeaders(),
      ...(config.headers || {}),
    },
  });
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

// 🔍 BUSQUEDA RÁPIDA Y ESTABLE
async function fetchSim(value) {
  const PAGE_SIZE = 200;
  const MAX_PAGES = 5;

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: page * PAGE_SIZE,
        length: PAGE_SIZE,
      },
    });

    const items = r.data?.data || [];

    const found = items.find(
      (item) =>
        String(item.iccid).trim() === String(value).trim() ||
        String(item.msisdn).trim() === String(value).trim()
    );

    if (found) {
      console.log("✅ SIM encontrada:", found.iccid);

      return {
        iccid: found.iccid,
        msisdn: found.msisdn,
        imsi: extractIMSI(found),
        estado: found.state || found.status || "N/A",
      };
    }

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO (NO BLOQUEANTE)
async function fetchUsageSafe(iccid) {
  try {
    const r = await axios({
      httpsAgent: agent,
      timeout: 5000,
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      headers: claroHeaders(),
      data: { iccid },
    });

    const data = r.data?.data || r.data || {};

    let totalBytes =
      data.totalBytes ||
      data.usageBytes ||
      data.totalData ||
      data.dataUsage ||
      0;

    return {
      consumoKB: Number((totalBytes / 1024).toFixed(2)),
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch {
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔥 PLAN (NO BLOQUEANTE)
async function fetchDevicePlan(iccid) {
  try {
    const r = await axios({
      httpsAgent: agent,
      timeout: 5000,
      method: "post",
      url: `${BASE_URL}/gcapi/device/detail`,
      headers: claroHeaders(),
      data: { iccid },
    });

    const data = r.data?.data || r.data || {};

    return (
      data.ratePlanName ||
      data.devicePlanName ||
      data.offerName ||
      data.planName ||
      "N/A"
    );

  } catch {
    return "N/A";
  }
}

// 🔍 ENDPOINT BUSCAR
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    // 🔥 ejecutar en paralelo SIN bloquear
    const consumoPromise = fetchUsageSafe(sim.iccid);
    const planPromise = fetchDevicePlan(sim.iccid);
    const totalPromise = getTotalSims();

    const consumo = await consumoPromise;
    const plan = await planPromise;
    const totalSims = await totalPromise;

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.estado,
      plan,
      consumoKB: consumo.consumoKB,
      consumoMB: consumo.consumoMB,
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔁 RESET
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim || !sim.imsi) {
      return res.json({
        ok: false,
        error: "SIM o IMSI no encontrado",
      });
    }

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi: sim.imsi },
    });

    res.json({
      ok: true,
      message: "Reset aplicado correctamente",
      ...sim,
      data: r.data,
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// START
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor listo");
});
