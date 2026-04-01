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

// REQUEST BASE
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

// 🔍 BUSQUEDA (ESTABLE)
async function fetchSim(value) {
  const PAGE_SIZE = 200;
  const MAX_PAGES = 8;

  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: page * PAGE_SIZE,
        length: PAGE_SIZE,
      },
    });

    const items = r.data?.data || [];

    const found = items.find(
      (item) =>
        String(item.iccid).trim() === String(value).trim() ||
        String(item.msisdn).trim() === String(value).trim()
    );

    if (found) {
      console.log("✅ SIM encontrada:", found.iccid);

      return {
        iccid: found.iccid,
        msisdn: found.msisdn,
        imsi: extractIMSI(found),
        estado: found.state || found.status || "N/A",
      };
    }

    if (items.length < PAGE_SIZE) break;
  }

  return null;
}

// 🔥 CONSUMO ULTRA ROBUSTO
async function fetchUsageSafe(iccid) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/dataUsage`,
      data: { iccid },
    });

    console.log("📊 DATA USAGE COMPLETO:", JSON.stringify(response.data, null, 2));

    const data = response.data;

    let totalBytes = 0;

    if (data?.data?.totalBytes) totalBytes = data.data.totalBytes;
    else if (data?.data?.usageBytes) totalBytes = data.data.usageBytes;
    else if (data?.data?.totalData) totalBytes = data.data.totalData;
    else if (data?.totalBytes) totalBytes = data.totalBytes;
    else if (data?.usage) totalBytes = data.usage;
    else if (Array.isArray(data?.data)) {
      totalBytes = data.data.reduce((sum, item) => {
        return sum + (item.totalBytes || item.usageBytes || 0);
      }, 0);
    }

    return {
      consumoKB: Number((totalBytes / 1024).toFixed(2)),
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch (error) {
    console.log("❌ ERROR CONSUMO:", error.message);
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔥 PLAN ULTRA ROBUSTO
async function fetchDevicePlan(iccid) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/detail`,
      data: { iccid },
    });

    console.log("📦 DEVICE DETAIL COMPLETO:", JSON.stringify(response.data, null, 2));

    const data = response.data?.data || response.data || {};

    return (
      data.ratePlanName ||
      data.devicePlanName ||
      data.offerName ||
      data.tariffName ||
      data.productName ||
      data.planName ||
      data.plan ||
      data.subscription?.ratePlanName ||
      data.subscription?.planName ||
      "N/A"
    );

  } catch (error) {
    console.log("❌ ERROR PLAN:", error.message);
    return "N/A";
  }
}

// 🔍 ENDPOINT BUSCAR
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [consumo, plan, totalSims] = await Promise.all([
      fetchUsageSafe(sim.iccid),
      fetchDevicePlan(sim.iccid),
      getTotalSims(),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.estado,
      plan,
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

    if (!sim || !sim.imsi) {
      return res.json({ ok: false, error: "SIM o IMSI no encontrado" });
    }

    console.log("🔁 RESET IMSI:", sim.imsi);

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
    console.log("❌ ERROR RESET:", error.message);

    res.status(500).json({ ok: false, error: error.message });
  }
});

// ROOT
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// START
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor listo");
});
