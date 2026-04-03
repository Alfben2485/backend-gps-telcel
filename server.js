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
    timeout: 15000,
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

// 🔹 IMSI BASE
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// 🔥 BUSQUEDA (NO SE TOCA)
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

    return {
      iccid: found.iccid,
      msisdn: found.msisdn,
      imsi: extractIMSI(found),
      estado: found.state || found.status || "N/A",
    };

  } catch (error) {
    console.log("❌ ERROR BUSQUEDA:", error.message);
    return null;
  }
}

//
// 🔥 OBTENER DATOS EXTRA (IMSI + PLAN)
//
async function getSimExtraData(sim) {
  try {
    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: {
        msisdn: sim.msisdn,
      },
    });

    const devices = r.data?.devices || [];

    const device = devices.find(
      (d) =>
        String(d.iccid).trim() === String(sim.iccid).trim()
    );

    if (!device) return {};

    return {
      imsi: device.imsi || sim.imsi,
      plan: device.devicePlans?.planName || "N/A",
    };

  } catch (e) {
    console.log("❌ ERROR EXTRA DATA:", e.message);
    return {};
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
// 🔥 CONSUMO (ROBUSTO)
//
async function fetchUsage(imsi) {
  try {
    if (!imsi) return { consumoMB: 0 };

    const { startDate, endDate } = getDateRange();

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/simUplink/usage`,
      data: {
        imsi,
        startDate,
        endDate,
      },
    });

    console.log("📊 RAW USAGE:", JSON.stringify(r.data, null, 2));

    const raw =
      r.data?.object ||
      r.data?.data ||
      r.data?.usage ||
      r.data?.result ||
      [];

    let totalMB = 0;

    if (Array.isArray(raw)) {
      raw.forEach((d) => {
        totalMB += Number(d["totalBytes(MB)"] || d.totalBytes || 0);
      });
    } else if (typeof raw === "object") {
      totalMB =
        Number(raw["totalBytes(MB)"]) ||
        Number(raw.totalBytes) ||
        0;
    }

    console.log("📊 TOTAL MB:", totalMB);

    return {
      consumoMB: Number(totalMB.toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
  }
}

// 🔍 BUSCAR (NO SE ROMPE)
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const extra = await getSimExtraData(sim);

    const imsi = extra.imsi || sim.imsi;
    const plan = extra.plan || "N/A";

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(imsi),
      getTotalSims(),
    ]);

    res.json({
      ok: true,
      totalSims,
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

// 🔁 RESET (FUNCIONANDO)
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const extra = await getSimExtraData(sim);
    const imsi = extra.imsi || sim.imsi;

    if (!imsi) {
      return res.json({
        ok: false,
        error: "IMSI no encontrado",
      });
    }

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi },
    });

    res.json({
      ok: true,
      message: "Reset aplicado correctamente",
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      imsi,
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
