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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NTYyOTQ1MzYzLCJ1c2VySWQiOjU3M30.y3MlkLoS5gblLXXiQ9BE47mDeXdySNOmhIwQurM_Spf63Brb8-BPtjpdzoEmlhrUriDcbauyIyG-GWwtW52G3Q"; // 🔥

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 REQUEST BASE
async function claroRequest(config) {
  return axios({
    httpsAgent: agent,
    timeout: 60000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...claroHeaders(),
      ...(config.headers || {}),
    },
  });
}

// 🔹 NORMALIZAR (🔥 PLAN CORRECTO)
function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || "",
    msisdn: item.msisdn || "",
    imsi: item.imsi || item.imsiNumber || "",
    estado: item.state || item.status || "N/A",

    // 🔥 PLAN REAL DEL DISPOSITIVO
    plan:
      item.ratePlanName ||
      item.offerName ||
      item.productName ||
      item.devicePlan ||
      item.servicePlan?.servicePlanName ||
      "N/A",
  };
}

// 🔹 CONVERTIR NÚMEROS
function toNumber(value) {
  if (!value) return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

// 🔥 TOTAL SIMS
async function fetchTotalSims() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 1,
    },
  });

  return response.data?.recordsFiltered || 0;
}

// 🔥 BUSCAR SIM (PAGINADO)
async function fetchSimByIccid(iccid) {
  const PAGE_SIZE = 500;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: page * PAGE_SIZE,
        length: PAGE_SIZE,
      },
    });

    const items = response.data?.data || [];

    const found = items.find(
      (item) =>
        String(item.iccid).trim() === String(iccid).trim()
    );

    if (found) return found;

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO (USANDO IMSI)
async function fetchUsage(imsi) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/sim/Data/Usage`,
    data: { imsi },
  });

  if (response.status < 200 || response.status >= 300) {
    return { totalKB: 0, totalMB: 0 };
  }

  const data = response.data?.data || {};

  let totalKB =
    toNumber(data.totalKB) ||
    toNumber(data.kb) ||
    toNumber(data.usageKB) ||
    0;

  // 🔥 si viene en bytes
  if (!totalKB && data.totalBytes) {
    totalKB = toNumber(data.totalBytes) / 1024;
  }

  const totalMB = Number((totalKB / 1024).toFixed(2));

  return {
    totalKB: Math.round(totalKB),
    totalMB,
  };
}

// 🔹 ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// 🔥 🔥 ENDPOINT COMPLETO
app.get("/api/device/full/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const simRaw = await fetchSimByIccid(iccid);

    if (!simRaw) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const sim = normalizeDevice(simRaw);

    const [usage, totalSims] = await Promise.all([
      fetchUsage(sim.imsi),
      fetchTotalSims(),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.estado,
      plan: sim.plan, // 🔥 ya correcto
      consumoMB: usage.totalMB,
      consumoKB: usage.totalKB,
    });

  } catch (error) {
    console.error("ERROR FULL:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔹 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
