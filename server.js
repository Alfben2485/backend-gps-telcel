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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NzE2MjM5MTM3LCJ1c2VySWQiOjU3M30.gXwIck0sVmRGSjWa2pCidp0BNIJw3cJlRqpVUM-KPiKrewCifwHvDQKaNVfYKAExlogV24gJHlIwGkXF1XVj_Q";

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

// 🔹 TOTAL SIMS
async function getTotalSims() {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { start: 0, length: 1 },
    });

    return response.data?.recordsFiltered || 0;
  } catch {
    return 0;
  }
}

// 🔥 BUSCAR SIM REAL (RECORRE TODAS)
async function fetchSim(iccid) {
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

    if (found) {
      console.log("✅ SIM ENCONTRADA:", found.iccid);
      return found;
    }

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO (DOBLE ENDPOINT COMO CLARO)
async function fetchUsageSafe(iccid) {

  // 🔹 1. PRIMER INTENTO
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: { iccid },
    });

    const data = response.data?.data || {};

    let totalKB =
      Number(data.totalKB) ||
      Number(data.usageKB) ||
      Number(data.totalBytes) / 1024 ||
      0;

    if (totalKB > 0) {
      return {
        consumoKB: totalKB,
        consumoMB: Number((totalKB / 1024).toFixed(2)),
      };
    }

  } catch (e) {
    console.log("⚠️ intento 1 falló");
  }

  // 🔹 2. SEGUNDO INTENTO (🔥 CLAVE)
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/usage/detail`,
      data: { iccid },
    });

    const data = response.data?.data || response.data || {};

    let totalKB =
      Number(data.totalUsageKB) ||
      Number(data.totalKB) ||
      Number(data.totalBytes) / 1024 ||
      0;

    if (totalKB > 0) {
      return {
        consumoKB: totalKB,
        consumoMB: Number((totalKB / 1024).toFixed(2)),
      };
    }

  } catch (e) {
    console.log("⚠️ intento 2 falló");
  }

  // 🔹 3. FALLBACK FINAL
  return {
    consumoKB: 0,
    consumoMB: 0,
  };
}

// 🔥 ENDPOINT FINAL
app.get("/api/device/full/:iccid", async (req, res) => {
  try {
    const iccid = req.params.iccid;

    console.log("🔍 BUSCANDO ICCID:", iccid);

    const sim = await fetchSim(iccid);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const consumo = await fetchUsageSafe(iccid);
    const totalSims = await getTotalSims();

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state || sim.status || "N/A",
      plan:
        sim.ratePlanName ||
        sim.servicePlan?.servicePlanName ||
        sim.planName ||
        "N/A",
      consumoKB: consumo.consumoKB,
      consumoMB: consumo.consumoMB,
    });

  } catch (error) {
    console.error("❌ ERROR:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔹 ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// 🔹 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
