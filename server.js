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
function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// REQUEST
async function req(config) {
  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: { ...headers(), ...(config.headers || {}) },
  });
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

// 🔍 BUSQUEDA (NO SE TOCA)
async function fetchSim(value) {
  const r = await req({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 10,
      search: { value },
    },
  });

  const items = r.data?.data || [];

  const sim = items.find(
    i =>
      String(i.iccid).trim() === String(value).trim() ||
      String(i.msisdn).trim() === String(value).trim()
  );

  if (!sim) return null;

  return {
    iccid: sim.iccid,
    msisdn: sim.msisdn,
    imsi: extractIMSI(sim),
    estado: sim.state || sim.status || "N/A",
  };
}

// 🔥 PLAN REAL DESDE /get/sims
async function fetchPlanFromSims(iccid) {
  try {
    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: {
        iccid: iccid,
      },
    });

    console.log("📦 RAW SIMS:", r.data);

    const data = r.data?.data || [];

    const sim = data.find(
      (s) => String(s.iccid).trim() === String(iccid).trim()
    );

    return sim?.servicePlanName || "N/A";

  } catch (e) {
    console.log("❌ ERROR PLAN:", e.message);
    return "N/A";
  }
}

// 🔥 CONSUMO (sessionHistory)
async function fetchUsage(sim) {
  try {
    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/device/sessionHistory`,
      data: {
        imsi: sim.imsi,
        start: 0,
        length: 1000,
      },
    });

    const sessions = r.data?.data || [];

    let totalBytes = 0;

    sessions.forEach((s) => {
      totalBytes += Number(s.totalBytes || 0);
    });

    return {
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch {
    return { consumoMB: 0 };
  }
}

// TOTAL SIMS
async function totalSims() {
  try {
    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { start: 0, length: 1 },
    });

    return r.data?.recordsFiltered || 0;
  } catch {
    return 0;
  }
}

// 🔍 API FINAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [plan, consumo, total] = await Promise.all([
      fetchPlanFromSims(sim.iccid),
      fetchUsage(sim),
      totalSims(),
    ]);

    res.json({
      ok: true,
      totalSims: total,
      ...sim,
      plan,
      consumoMB: consumo.consumoMB,
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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

    const r = await req({
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

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SERVIDOR LISTO");
});
