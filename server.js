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

// 🔥 EXTRAER IMSI (ROBUSTO)
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔥 BUSCAR SIM
async function fetchSim(value) {
  const PAGE_SIZE = 500;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: page * PAGE_SIZE,
        length: PAGE_SIZE,
      },
    });

    const items = response.data?.data || [];

    const found = items.find(
      (item) =>
        String(item.iccid).trim() === String(value).trim() ||
        String(item.msisdn).trim() === String(value).trim()
    );

    if (found) {
      const imsi = extractIMSI(found);

      console.log("✅ SIM encontrada:");
      console.log("ICCID:", found.iccid);
      console.log("IMSI:", imsi);

      return {
        iccid: found.iccid,
        msisdn: found.msisdn,
        imsi: imsi,
        estado: found.state || found.status || "N/A",
        plan:
          found.ratePlanName ||
          found.servicePlan?.servicePlanName ||
          found.planName ||
          "N/A",
      };
    }

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO REAL (ENDPOINT CORRECTO)
async function fetchUsageSafe(iccid) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      data: {
        iccid: iccid,
      },
    });

    const data = response.data?.data || response.data || {};

    console.log("📊 DATA USAGE RAW:", data);

    let totalBytes =
      data.totalBytes ||
      data.usageBytes ||
      data.totalData ||
      data.dataUsage ||
      (data.totalKB ? data.totalKB * 1024 : 0) ||
      0;

    const totalKB = totalBytes / 1024;
    const totalMB = totalKB / 1024;

    return {
      consumoKB: Number(totalKB.toFixed(2)),
      consumoMB: Number(totalMB.toFixed(2)),
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
      return res.json({
        ok: false,
        error: "IMSI no encontrado en la SIM",
      });
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
      imsi: sim.imsi,
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
