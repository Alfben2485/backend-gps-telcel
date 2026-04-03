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

// 🔹 HEADERS
function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 REQUEST BASE
async function req(config) {
  return axios({
    httpsAgent: agent,
    timeout: 15000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...headers(),
      ...(config.headers || {}),
    },
  });
}

// 🔹 IMSI
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔍 BUSQUEDA (NO TOCAR)
async function fetchSim(value) {
  try {
    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 10,
        search: { value },
      },
    });

    const items = r.data?.data || [];

    const sim = items.find(
      (i) =>
        String(i.iccid).trim() === String(value).trim() ||
        String(i.msisdn).trim() === String(value).trim()
    );

    if (!sim) return null;

    return {
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      imsi: extractIMSI(sim),
      estado: sim.state || sim.status || "N/A",
    };

  } catch (error) {
    console.log("❌ ERROR BUSQUEDA:", error.message);
    return null;
  }
}

//
// 🔥 FECHAS (27 → 25)
//
function getDateRange() {
  const now = new Date();

  let start, end;

  if (now.getDate() >= 27) {
    start = new Date(now.getFullYear(), now.getMonth(), 27);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 25);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 27);
    end = new Date(now.getFullYear(), now.getMonth(), 25);
  }

  const format = (d) => d.toISOString().split("T")[0];

  return {
    startDate: format(start),
    endDate: format(end),
  };
}

//
// 🔥 CONSUMO REAL (simUplink/usage)
//
async function fetchUsage(sim) {
  try {
    if (!sim.imsi) return { consumoMB: 0 };

    const { startDate, endDate } = getDateRange();

    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/simUplink/usage`,
      data: {
        imsi: sim.imsi,
        startDate,
        endDate,
      },
    });

    console.log("📊 USAGE:", r.data);

    const data = r.data?.object || [];

    let totalMB = 0;

    data.forEach((d) => {
      totalMB += Number(d["totalBytes(MB)"] || 0);
    });

    return {
      consumoMB: Number(totalMB.toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
  }
}

//
// 🔥 PLAN REAL (devicePlans.planName)
//
async function fetchPlan(sim) {
  try {
    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: {
        msisdn: sim.msisdn,
      },
    });

    console.log("📦 PLAN DATA:", r.data);

    const devices = r.data?.devices || [];

    if (!devices.length) return "N/A";

    const device = devices.find(
      (d) =>
        String(d.iccid).trim() === String(sim.iccid).trim()
    );

    if (!device) return "N/A";

    return device.devicePlans?.planName || "N/A";

  } catch (e) {
    console.log("❌ ERROR PLAN:", e.message);
    return "N/A";
  }
}

// 🔹 TOTAL SIMS
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

// 🔍 ENDPOINT PRINCIPAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const [plan, consumo, total] = await Promise.all([
      fetchPlan(sim),
      fetchUsage(sim),
      totalSims(),
    ]);

    res.json({
      ok: true,
      totalSims: total,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.estado,
      plan,
      consumoMB: consumo.consumoMB,
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 🔁 RESET (NO SE TOCA)
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim || !sim.imsi) {
      return res.json({
        ok: false,
        error: "IMSI no encontrado",
      });
    }

    const r = await req({
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
