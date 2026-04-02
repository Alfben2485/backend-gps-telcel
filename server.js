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

// HEADERS
function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// REQUEST
async function reqClaro(config) {
  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: { ...headers(), ...(config.headers || {}) },
  });
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
    imsi:
      sim.imsi ||
      sim.subscription?.imsi ||
      sim.sim?.imsi ||
      null,
    estado: sim.state || sim.status,
    plan:
      sim.servicePlanName ||
      sim.ratePlan ||
      "N/A",
  };
}

// 📊 CONSUMO REAL (CORRECTO)
async function fetchUsage(imsi) {
  try {
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - 7); // últimos 7 días

    const format = d =>
      d.toISOString().slice(0, 16).replace("T", " ");

    const r = await axios({
      httpsAgent: agent,
      timeout: 10000,
      method: "get",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      headers: headers(),
      params: {
        imsi,
        fromDate: format(past),
        toDate: format(now),
      },
    });

    const d = r.data || {};

    const totalBytes =
      Number(d.totalUsage) ||
      (Number(d.totalDownloaded) + Number(d.totalUploaded)) ||
      0;

    return {
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch (e) {
    console.log("ERROR CONSUMO:", e.message);
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

// 🔍 API PRINCIPAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [usage, total] = await Promise.all([
      fetchUsage(sim.imsi),
      totalSims(),
    ]);

    res.json({
      ok: true,
      totalSims: total,
      ...sim,
      consumoMB: usage.consumoMB,
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// RESET
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim?.imsi) {
      return res.json({ ok: false, error: "IMSI no encontrado" });
    }

    const r = await reqClaro({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi: sim.imsi },
    });

    res.json({ ok: true, ...sim, data: r.data });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// START
app.listen(3000, () => console.log("🚀 OK"));
