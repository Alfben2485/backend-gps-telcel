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

// 🔥 BUSCAR SIM (ICCID o MSISDN)
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
      console.log("✅ ENCONTRADO:", found.iccid);
      return found;
    }

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO (DOBLE ENDPOINT)
async function fetchUsageSafe(iccid) {

  // 🔹 INTENTO 1
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

    if (totalKB > 0) {
      return {
        consumoKB: totalKB,
        consumoMB: Number((totalKB / 1024).toFixed(2)),
      };
    }

  } catch (e) {
    console.log("⚠️ intento 1 falló");
  }

  // 🔹 INTENTO 2
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/usage/detail`,
      data: { iccid },
    });

    const data = response.data?.data || response.data || {};

    let totalKB =
      Number(data.totalUsageKB) ||
      Number(data.totalKB) ||
      Number(data.totalBytes) / 1024 ||
      0;

    if (totalKB > 0) {
      return {
        consumoKB: totalKB,
        consumoMB: Number((totalKB / 1024).toFixed(2)),
      };
    }

  } catch (e) {
    console.log("⚠️ intento 2 falló");
  }

  return {
    consumoKB: 0,
    consumoMB: 0,
  };
}

// 🔍 ENDPOINT BUSCAR
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const value = req.params.value;

    console.log("🔍 BUSCANDO:", value);

    const sim = await fetchSim(value);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const consumo = await fetchUsageSafe(sim.iccid);
    const totalSims = await getTotalSims();

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state || sim.status || "N/A",
      plan:
        sim.ratePlanName ||
        sim.servicePlan?.servicePlanName ||
        sim.planName ||
        "N/A",
      consumoKB: consumo.consumoKB,
      consumoMB: consumo.consumoMB,
    });

  } catch (error) {
    console.error("❌ ERROR:", error.message);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔁 RESET REAL (ICCID o MSISDN)
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const value = req.params.value;

    console.log("🔁 RESET solicitado:", value);

    const sim = await fetchSim(value);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    // 🔥 INTENTO 1: ICCID
    try {
      const response = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/sim/reset`,
        data: {
          iccid: sim.iccid,
        },
      });

      return res.json({
        ok: true,
        message: "Reset aplicado correctamente (ICCID)",
        data: response.data,
      });

    } catch (e) {
      console.log("⚠️ intento ICCID falló");
    }

    // 🔥 INTENTO 2: IMSI
    if (sim.imsi) {
      try {
        const response = await claroRequest({
          method: "post",
          url: `${BASE_URL}/gcapi/sim/reset`,
          data: {
            imsi: sim.imsi,
          },
        });

        return res.json({
          ok: true,
          message: "Reset aplicado correctamente (IMSI)",
          data: response.data,
        });

      } catch (e) {
        console.log("⚠️ intento IMSI falló");
      }
    }

    // ❌ FALLA TOTAL
    res.json({
      ok: false,
      error: "No se pudo aplicar reset",
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

// 🔹 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
