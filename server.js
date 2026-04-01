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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0OTgyNzgzNTI4LCJ1c2VySWQiOjU3M30.kGtW9zgJ4MmL1B4QCYYDGGjpCLfVU-IqT9nBPhYDEjgUsaCAaIDlZWeQcQDa5xHRzGt_GiZoq_zO5xX-QsyxDg"; // ⚠️ CAMBIA ESTO

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 REQUEST BASE (más rápido)
async function claroRequest(config) {
  return axios({
    httpsAgent: agent,
    timeout: 15000, // 🔥 antes 60000
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

// 🔥 EXTRAER IMSI
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔥 BUSCAR SIM (OPTIMIZADO)
async function fetchSim(value) {
  const PAGE_SIZE = 500;
  const MAX_PAGES = 8; // 🔥 antes 50 (gran mejora)

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

      console.log("✅ SIM encontrada:", found.iccid);

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

    // 🔥 cortar si ya no hay más datos
    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO (más rápido)
async function fetchUsageSafe(iccid) {
  try {
    const response = await axios({
      httpsAgent: agent,
      timeout: 8000,
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      headers: claroHeaders(),
      data: { iccid },
    });

    const data = response.data?.data || {};

    const totalKB =
      Number(data.totalKB) ||
      Number(data.usageKB) ||
      Number(data.totalBytes) / 1024 ||
      0;

    return {
      consumoKB: totalKB,
      consumoMB: Number((totalKB / 1024).toFixed(2)),
    };
  } catch {
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔍 BUSCAR (OPTIMIZADO)
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    // 🔥 en paralelo (más rápido)
    const [consumo, totalSims] = await Promise.all([
      fetchUsageSafe(sim.iccid),
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

// 🔁 RESET
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
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// START
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
