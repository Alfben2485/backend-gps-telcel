const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const agent = new https.Agent({ rejectUnauthorized: false });

const BASE_URL = "https://cc.amx.claroconnect.com:8443";
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc1MTU2NDQ4MjA4LCJ1c2VySWQiOjU3M30.HqOlwnoPazM0vigG0sPf6hKmfiCcTJnDO9Y6m9f69yopGGWt60RJxQmE-aARjZVf2T8cGKdJl7hz6rU_JZ541A";

// 🔹 HEADERS
function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 REQUEST
async function reqClaro(config) {
  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: { ...headers(), ...(config.headers || {}) },
  });
}

// 🔹 EXTRAER ACCOUNT ID DEL TOKEN
function getAccountId() {
  try {
    const payload = JSON.parse(
      Buffer.from(TOKEN.split(".")[1], "base64").toString()
    );
    return payload.accountId;
  } catch {
    return null;
  }
}

// 🔍 BUSCAR SIM
async function fetchSim(value) {
  const r = await reqClaro({
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
    i =>
      String(i.iccid).trim() === value ||
      String(i.msisdn).trim() === value
  );

  if (!sim) return null;

  return {
    iccid: sim.iccid,
    msisdn: sim.msisdn,
    devicePlanId: sim.devicePlanId,
    estado: sim.state || sim.status,
  };
}

// 🔥 OBTENER PLAN REAL
async function fetchPlan(devicePlanId) {
  try {
    const accountId = getAccountId();

    const r = await reqClaro({
      method: "get",
      url: `${BASE_URL}/gcapi/get/service/device/plan/id/${accountId}`,
    });

    const plans = r.data?.data || r.data || [];

    const match = plans.find(p => p.id == devicePlanId);

    return match?.name || "N/A";

  } catch (e) {
    console.log("❌ ERROR PLAN:", e.message);
    return "N/A";
  }
}

// 🔥 CONSUMO REAL
async function fetchUsage(iccid) {
  try {
    const r = await reqClaro({
      method: "post",
      url: `${BASE_URL}/gcapi/consumed/usage`,
      data: {
        iccid: iccid,
      },
    });

    const d = r.data?.data || r.data || {};

    console.log("📊 CONSUMO RAW:", d);

    let mb =
      Number(d.totalMB) ||
      Number(d.totalUsageMB) ||
      Number(d.usage) ||
      0;

    return { consumoMB: mb };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
  }
}

// 🔢 TOTAL SIMS
async function totalSims() {
  try {
    const r = await reqClaro({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { start: 0, length: 1 },
    });

    return r.data?.recordsFiltered || 0;
  } catch {
    return 0;
  }
}

// 🔍 API
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [plan, consumo, total] = await Promise.all([
      fetchPlan(sim.devicePlanId),
      fetchUsage(sim.iccid),
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

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const r = await reqClaro({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { iccid: sim.iccid },
    });

    res.json({ ok: true, ...sim, data: r.data });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(3000, () => console.log("🚀 SERVIDOR OK"));
