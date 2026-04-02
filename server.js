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
    timeout: 15000,
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

// 🔍 BUSQUEDA (NO SE TOCA)
async function fetchSim(value) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 10,
        search: {
          value: value,
        },
      },
    });

    const items = response.data?.data || [];

    const found = items.find(
      (item) =>
        String(item.iccid).trim() === String(value).trim() ||
        String(item.msisdn).trim() === String(value).trim()
    );

    if (!found) return null;

    const imsi = extractIMSI(found);

    console.log("✅ SIM encontrada:", found.iccid);

    return {
      iccid: found.iccid,
      msisdn: found.msisdn,
      imsi,
      estado: found.state || found.status || "N/A",

      // 🔥 PLAN MEJORADO (SIN INVENTAR)
      plan:
        found.servicePlan?.servicePlanName ||
        found.servicePlanName ||
        found.ratePlanName ||
        found.planName ||
        "N/A",
    };

  } catch (error) {
    console.log("❌ ERROR BUSQUEDA:", error.message);
    return null;
  }
}

// 🔥 CONSUMO (EL QUE SÍ TE FUNCIONABA PERO CORREGIDO)
async function fetchUsageSafe(iccid) {
  try {
    const r = await axios({
      httpsAgent: agent,
      timeout: 8000,
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      headers: claroHeaders(),
      data: {
        iccid: iccid,
        // 🔥 agregado clave
        startDate: "2024-01-01",
        endDate: new Date().toISOString().slice(0, 10),
      },
    });

    console.log("📊 RAW USAGE:", r.data);

    const data = r.data?.data || {};

    const totalKB =
      Number(data.totalKB) ||
      Number(data.usageKB) ||
      (Number(data.totalBytes) / 1024) ||
      0;

    return {
      consumoKB: totalKB,
      consumoMB: Number((totalKB / 1024).toFixed(2)),
    };
  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoKB: 0, consumoMB: 0 };
  }
}

// 🔍 BUSCAR
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

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

// RESET (SE DEJA COMO LO TENÍAS BIEN)
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim || !sim.imsi) {
      return res.json({
        ok: false,
        error: "SIM o IMSI no encontrado",
      });
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
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor listo");
});
