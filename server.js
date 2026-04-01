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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0OTgyNzgzNTI4LCJ1c2VySWQiOjU3M30.kGtW9zgJ4MmL1B4QCYYDGGjpCLfVU-IqT9nBPhYDEjgUsaCAaIDlZWeQcQDa5xHRzGt_GiZoq_zO5xX-QsyxDg";

// HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// REQUEST
async function claroRequest(config) {
  return axios({
    httpsAgent: agent,
    timeout: 20000,
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

    return r.data?.recordsFiltered || 0;
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

// 🔍 BUSCAR
async function fetchSim(value) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 1,
        search: { value },
      },
    });

    const sim = r.data?.data?.[0];
    if (!sim) return null;

    return {
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      imsi: extractIMSI(sim),
      estado: sim.state || sim.status || "N/A",
    };
  } catch {
    return null;
  }
}

// 🔥 PLAN REAL
async function fetchDevicePlan(iccid) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/attachDevicePlan`,
      data: { iccid },
    });

    const data = r.data?.data || r.data || {};

    console.log("📦 PLAN RAW:", data);

    return (
      data.devicePlanName ||
      data.planName ||
      data.ratePlanName ||
      data.offerName ||
      "N/A"
    );
  } catch {
    return "N/A";
  }
}

// 🔥 CONSUMO
async function fetchUsageSafe(iccid) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      data: { iccid },
    });

    const data = r.data?.data || r.data || {};

    let totalBytes =
      data.totalBytes ||
      data.usageBytes ||
      data.totalData ||
      data.dataUsage ||
      (data.totalKB ? data.totalKB * 1024 : 0) ||
      0;

    return {
      consumoKB: Number((totalBytes / 1024).toFixed(2)),
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };
  } catch {
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔍 ENDPOINT
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const consumo = await fetchUsageSafe(sim.iccid);
    const totalSims = await getTotalSims();
    const plan = await fetchDevicePlan(sim.iccid);

    res.json({
      ok: true,
      totalSims,
      ...sim,
      plan,
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
      return res.json({ ok: false, error: "SIM o IMSI no encontrado" });
    }

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi: sim.imsi },
    });

    res.json({
      ok: true,
      message: "Reset aplicado correctamente",
      ...sim,
      data: r.data,
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// START
app.listen(process.env.PORT || 3000);
