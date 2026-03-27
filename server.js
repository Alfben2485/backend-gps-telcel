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

// 🔹 TOTAL SIMS
async function getTotalSims() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: { start: 0, length: 1 },
  });

  return response.data?.recordsFiltered || 0;
}

// 🔹 BUSCAR SIM
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

  const items = response.data?.data || [];
  return items[0] || null;
}

// 🔥 CONSUMO (SOLO SI ESTA ACTIVA)
async function fetchUsageSafe(iccid, estado) {
  // 🔥 SI ESTA SUSPENDIDA → NO CONSULTAR
  if (
    estado === "Suspended" ||
    estado === "Deactivated" ||
    estado === "Inactive"
  ) {
    return {
      consumoKB: 0,
      consumoMB: "No disponible",
    };
  }

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

    const totalMB = Number((totalKB / 1024).toFixed(2));

    return {
      consumoKB: totalKB,
      consumoMB: totalMB,
    };
  } catch (error) {
    return {
      consumoKB: 0,
      consumoMB: 0,
    };
  }
}

// 🔥 ENDPOINT FINAL
app.get("/api/device/full/:iccid", async (req, res) => {
  try {
    const iccid = req.params.iccid;

    const sim = await fetchSim(iccid);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const estado = sim.state || sim.status || "N/A";

    // 🔥 USO SEGURO
    const consumo = await fetchUsageSafe(iccid, estado);

    const totalSims = await getTotalSims();

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: estado,
      plan:
        sim.ratePlanName ||
        sim.servicePlan?.servicePlanName ||
        "N/A",
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

// 🔹 ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// 🔹 START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
