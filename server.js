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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NTYyOTQ1MzYzLCJ1c2VySWQiOjU3M30.y3MlkLoS5gblLXXiQ9BE47mDeXdySNOmhIwQurM_Spf63Brb8-BPtjpdzoEmlhrUriDcbauyIyG-GWwtW52G3Q";

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

// 🔹 FORMATEAR ERRORES
function formatError(error) {
  return error?.response?.data || error?.message || "Error desconocido";
}

// 🔹 NORMALIZAR PLAN (🔥 CORREGIDO)
function getPlanName(item) {
  return (
    item?.devicePlanName ||
    item?.ratePlanName ||
    item?.servicePlan?.servicePlanName ||
    item?.planName ||
    item?.plan ||
    "N/A"
  );
}

// 🔥 OBTENER TOTAL DE SIMS
async function getTotalSims() {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 1,
      },
    });

    return response.data?.recordsFiltered || 0;
  } catch (e) {
    return 0;
  }
}

// 🔥 BUSCAR SIM (MEJORADO)
async function fetchSim(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 1,
      iccid: iccid,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Error ${response.status}`);
  }

  const items = response.data?.data || [];

  if (items.length === 0) return null;

  return items[0];
}

// 🔥 USO DE DATOS (CORREGIDO CON FALLBACK)
async function fetchUsage(iccid) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: { iccid },
    });

    const data = response.data?.data || response.data || {};

    const totalKB =
      Number(data.totalKB) ||
      Number(data.usageKB) ||
      Number(data.totalBytes) / 1024 ||
      0;

    const totalMB = Number((totalKB / 1024).toFixed(2));

    return {
      totalKB,
      totalMB,
    };
  } catch (error) {
    console.log("⚠️ SIN USO DE DATOS:", iccid);
    return {
      totalKB: 0,
      totalMB: 0,
    };
  }
}

// 🔹 RUTA PRINCIPAL
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// 🔥 BUSCAR SIM COMPLETA
app.get("/api/device/:iccid", async (req, res) => {
  try {
    const iccid = req.params.iccid;

    console.log("🔍 BUSCANDO:", iccid);

    const sim = await fetchSim(iccid);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    // 🔥 DATOS BASE
    const iccidResp = sim.iccid || "";
    const msisdn = sim.msisdn || "";
    const estado = sim.state || sim.status || "N/A";
    const plan = getPlanName(sim);

    // 🔥 USO (NO ROMPE SI FALLA)
    const usage = await fetchUsage(iccidResp);

    // 🔥 TOTAL SIMS
    const totalSims = await getTotalSims();

    res.json({
      ok: true,
      totalSims,
      iccid: iccidResp,
      msisdn,
      estado,
      plan,
      consumoMB: usage.totalMB,
      consumoKB: usage.totalKB,
    });

  } catch (error) {
    console.error("❌ ERROR:", formatError(error));

    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

// 🔹 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
