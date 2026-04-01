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
    timeout: 20000,
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

// 🔹 EXTRAER IMSI
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔥 EXTRAER PLAN CORRECTO (DISPOSITIVO)
function extractPlan(sim) {
  return (
    sim.ratePlanName ||
    sim.subscription?.ratePlanName ||
    sim.offerName ||
    sim.tariffName ||
    sim.productName ||
    sim.planName ||
    sim.servicePlanName ||
    sim.servicePlan?.servicePlanName ||
    "N/A"
  );
}

// 🔥 BÚSQUEDA RÁPIDA CON FILTRO
async function fetchSim(value) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 1,
        search: {
          value: value,
        },
      },
    });

    const items = response.data?.data || [];

    if (!items.length) return null;

    const sim = items[0];

    console.log("📦 SIM COMPLETA:", sim);

    return {
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      imsi: extractIMSI(sim),
      estado: sim.state || sim.status || "N/A",
      plan: extractPlan(sim),
    };

  } catch (error) {
    console.error("❌ ERROR BUSQUEDA:", error.message);
    return null;
  }
}

// 🔥 CONSUMO REAL
async function fetchUsageSafe(iccid) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      data: { iccid },
    });

    const data = response.data?.data || response.data || {};

    console.log("📊 USO RAW:", data);

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

  } catch (error) {
    console.log("❌ ERROR CONSUMO:", error.message);

    return {
      consumoKB: 0,
      consumoMB: 0,
    };
  }
}

// 🔍 BUSCAR
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const consumo = await fetchUsageSafe(sim.iccid);
    const totalSims = await getTotalSims();

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

// 🔁 RESET CON IMSI
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    if (!sim.imsi) {
      return res.json({ ok: false, error: "IMSI no encontrado" });
    }

    console.log("🔁 RESET usando IMSI:", sim.imsi);

    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: {
        imsi: sim.imsi,
      },
    });

    res.json({
      ok: true,
      message: "Reset aplicado correctamente",
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      plan: sim.plan,
      data: response.data,
    });

  } catch (error) {
    console.error("❌ ERROR RESET:", error.message);

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
