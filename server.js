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
function getIMSI(i) {
  return (
    i.imsi ||
    i.subscription?.imsi ||
    i.sim?.imsi ||
    i.deviceInfo?.imsi ||
    null
  );
}

// 🔍 BUSCAR SIM
async function fetchSim(value) {
  const r = await req({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 20,
      search: { value },
    },
  });

  const items = r.data?.data || [];

  const sim = items.find(
    (i) =>
      String(i.iccid).trim() === value ||
      String(i.msisdn).trim() === value
  );

  if (!sim) return null;

  console.log("🔎 RAW SIM:", JSON.stringify(sim, null, 2));

  return {
    raw: sim,
    iccid: sim.iccid,
    msisdn: sim.msisdn,
    imsi: getIMSI(sim),
    estado: sim.state || sim.status || "N/A",
  };
}

// 🔥 EXTRAER PLAN DINÁMICO
function extractPlan(raw) {
  return (
    raw.servicePlan?.name ||
    raw.servicePlan?.servicePlanName ||
    raw.servicePlanName ||
    raw.ratePlanName ||
    raw.planName ||
    raw.offerName ||
    raw.productName ||
    raw.tariffName ||
    raw?.subscription?.planName ||
    raw?.subscription?.offerName ||
    "N/A"
  );
}

// 🔥 CONSUMO UNIVERSAL (TODOS LOS ENDPOINTS)
async function fetchUsage(sim) {
  try {
    let totalBytes = 0;

    // 1️⃣ sessionHistory
    try {
      const r1 = await req({
        method: "post",
        url: `${BASE_URL}/gcapi/device/sessionHistory`,
        data: {
          imsi: sim.imsi,
          start: 0,
          length: 1000,
        },
      });

      console.log("📊 sessionHistory:", r1.data);

      const data = r1.data?.data || [];

      data.forEach((s) => {
        totalBytes +=
          Number(s.totalBytes) ||
          Number(s.dataVolume) ||
          Number(s.bytes) ||
          0;
      });

    } catch {}

    // 2️⃣ sim/Data/Usage
    if (totalBytes === 0) {
      try {
        const r2 = await req({
          method: "post",
          url: `${BASE_URL}/gcapi/sim/Data/Usage`,
          data: { iccid: sim.iccid },
        });

        console.log("📊 sim/Data/Usage:", r2.data);

        const d = r2.data?.data || {};

        totalBytes =
          Number(d.totalBytes) ||
          Number(d.usageBytes) ||
          Number(d.totalKB) * 1024 ||
          0;

      } catch {}
    }

    return {
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR:", e.message);
    return { consumoMB: 0 };
  }
}

// TOTAL
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

    const plan = extractPlan(sim.raw);
    const consumo = await fetchUsage(sim);
    const total = await totalSims();

    res.json({
      ok: true,
      totalSims: total,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.estado,
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
      return res.json({ ok: false, error: "IMSI no encontrado" });
    }

    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi: sim.imsi },
    });

    res.json({ ok: true, data: r.data });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(3000, () => console.log("🚀 SERVIDOR LISTO"));
