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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc1MjQzNzc3NjI2LCJ1c2VySWQiOjU3M30.RMrthfrWTUjwKkWJR6fB5gZyJDVFgYJnIomTi_bc9qinjO7nuciP_f7Bc76mJ5LpgDaugAMKdI8xo6YZe7NV_g";

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

// 🔍 BUSCAR SIM
async function fetchSim(value) {
  try {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        start: 0,
        length: 10,
        search: { value },
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

// 🔥 EXTRA DATA (PLAN + IMSI)
async function getSimExtraData(sim) {
  try {
    const body = {};
    if (sim.msisdn) body.msisdn = sim.msisdn;
    if (sim.iccid) body.iccid = sim.iccid;

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: body,
    });

    const devices = r.data?.devices || [];

    const device = devices.find(
      (d) =>
        String(d.iccid).trim() === String(sim.iccid).trim() ||
        String(d.msisdn).trim() === String(sim.msisdn).trim()
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

// 🔥 CONSUMO REAL (BUNDLE DETAILS)
async function fetchUsage(iccid) {
  try {
    if (!iccid) return { consumoMB: 0 };

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/bundleDetails`,
      data: {
        iccid: iccid,
      },
    });

    console.log("📊 BUNDLE DETAILS:", JSON.stringify(r.data));

    const bundles =
      r.data?.bundles ||
      r.data?.data ||
      [];

    let used = 0;

    if (Array.isArray(bundles)) {
      bundles.forEach((b) => {
        used += Number(
          b.usedVolume ||
          b.used ||
          b.consumedVolume ||
          0
        );
      });
    }

    // 🔥 convertir a MB (normalmente viene en KB)
    const consumoMB = used / 1024;

    console.log("📊 CONSUMO MB:", consumoMB);

    return {
      consumoMB: Number(consumoMB.toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
  }
}

// 🔍 ENDPOINT PRINCIPAL
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);

    if (!sim) {
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const extra = await getSimExtraData(sim);

    const plan = extra.plan || "N/A";

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(sim.iccid), // 🔥 CAMBIO IMPORTANTE
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
      return res.json({ ok: false, error: "SIM no encontrada" });
    }

    const extra = await getSimExtraData(sim);
    const imsi = extra.imsi || sim.imsi;

    if (!imsi) {
      return res.json({ ok: false, error: "IMSI no encontrado" });
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
