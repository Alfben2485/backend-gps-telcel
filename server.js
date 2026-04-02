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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc1MTU2NDQ4MjA4LCJ1c2VySWQiOjU3M30.HqOlwnoPazM0vigG0sPf6hKmfiCcTJnDO9Y6m9f69yopGGWt60RJxQmE-aARjZVf2T8cGKdJl7hz6rU_JZ541A";

// HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// REQUEST BASE
async function claroRequest(config) {
  return axios({
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

// TOTAL SIMS
async function getTotalSims() {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { start: 0, length: 1 },
    });

    return r.data?.recordsFiltered || r.data?.recordsTotal || 0;
  } catch {
    return 0;
  }
}

// IMSI
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔍 BUSQUEDA (RÁPIDA)
async function fetchSim(value) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 20,
      search: { value },
    },
  });

  const items = response.data?.data || [];

  const found = items.find(
    (item) =>
      String(item.iccid).trim() === String(value).trim() ||
      String(item.msisdn).trim() === String(value).trim()
  );

  if (!found) return null;

  return {
    iccid: found.iccid,
    msisdn: found.msisdn,
    imsi: extractIMSI(found),
    estado: found.state || found.status || "N/A",

    // 🔥 PLAN REAL QUE SÍ FUNCIONA EN TU CUENTA
    plan:
      found.servicePlan?.servicePlanName ||
      found.servicePlanName ||
      found.ratePlanName ||
      "N/A",
  };
}

// 🔥 CONSUMO REAL (CORREGIDO DEFINITIVO)
async function fetchUsage(iccid) {
  try {
    const r = await axios({
      httpsAgent: agent,
      timeout: 10000,
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      headers: claroHeaders(),
      data: {
        iccid: iccid,
      },
    });

    const data = r.data?.data || r.data || {};

    console.log("📊 CONSUMO RAW:", data);

    let totalBytes = 0;

    if (data.totalBytes) totalBytes = data.totalBytes;
    else if (data.usageBytes) totalBytes = data.usageBytes;
    else if (data.totalData) totalBytes = data.totalData;
    else if (Array.isArray(data)) {
      totalBytes = data.reduce((sum, x) => {
        return sum + (x.totalBytes || x.usageBytes || 0);
      }, 0);
    }

    return {
      consumoKB: Number((totalBytes / 1024).toFixed(2)),
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔍 ENDPOINT PRINCIPAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(sim.iccid),
      getTotalSims(),
    ]);

    res.json({
      ok: true,
      totalSims,
      ...sim,
      consumoKB: consumo.consumoKB,
      consumoMB: consumo.consumoMB,
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// RESET
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim || !sim.imsi) {
      return res.json({
        ok: false,
        error: "IMSI no encontrado",
      });
    }

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi: sim.imsi },
    });

    res.json({
      ok: true,
      message: "Reset aplicado",
      ...sim,
      data: r.data,
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// START
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor listo");
});
