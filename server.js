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

// 🔹 NORMALIZAR SIM
function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || "",
    msisdn: item.msisdn || "",
    estado: item.state || item.status || "N/A",
    plan:
      item.servicePlan?.servicePlanName ||
      item.plan ||
      "N/A",
  };
}

// 🔹 TOTAL DE SIMS 🔥
async function fetchTotalSims() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 1, // 🔥 solo pedimos 1 para obtener el total
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  return response.data?.recordsFiltered || 0;
}

// 🔹 BUSCAR SIM
async function fetchSimByIccid(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { iccid },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const items = response.data?.data || [];
  return items[0] || null;
}

// 🔹 CONSUMO
async function fetchUsage(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/sim/Data/Usage`,
    data: { iccid },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const usageData = response.data?.data || {};

  const totalKB =
    usageData.totalKB ||
    usageData.kb ||
    usageData.usageKB ||
    0;

  const totalMB = Number((totalKB / 1024).toFixed(2));

  return {
    totalKB,
    totalMB,
  };
}

// 🔹 ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// 🔥 🔥 ENDPOINT COMPLETO (SIM + CONSUMO + TOTAL)
app.get("/api/device/full/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    // 🔥 ejecutar en paralelo (más rápido)
    const [sim, usage, totalSims] = await Promise.all([
      fetchSimByIccid(iccid),
      fetchUsage(iccid),
      fetchTotalSims(),
    ]);

    if (!sim) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state || sim.status,
      plan:
        sim.servicePlan?.servicePlanName ||
        sim.plan ||
        "N/A",
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

// 🔹 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
