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

// 🔥 BUSQUEDA (ESTA ES LA BUENA - NO TOCAR)
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

    console.log("✅ SIM encontrada:", sim.iccid);

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

// 🔥 PLAN REAL (CON PAGINACIÓN)
async function fetchPlanFromSims(iccid) {
  try {
    const PAGE_SIZE = 500;
    const MAX_PAGES = 30;

    for (let page = 0; page < MAX_PAGES; page++) {

      const r = await req({
        method: "post",
        url: `${BASE_URL}/gcapi/get/sims`,
        data: {
          start: page * PAGE_SIZE,
          length: PAGE_SIZE,
        },
      });

      const data = r.data?.data || [];

      console.log(`📦 Página ${page}: ${data.length} sims`);

      const sim = data.find(
        (s) =>
          String(s.iccid).trim() === String(iccid).trim()
      );

      if (sim) {
        console.log("✅ PLAN:", sim.servicePlanName);
        return sim.servicePlanName || "N/A";
      }

      if (data.length < PAGE_SIZE) break;
    }

    console.log("❌ PLAN NO ENCONTRADO");
    return "N/A";

  } catch (e) {
    console.log("❌ ERROR PLAN:", e.message);
    return "N/A";
  }
}

// 🔥 CONSUMO (SESSION HISTORY)
async function fetchUsage(sim) {
  try {
    if (!sim.imsi) {
      console.log("❌ SIN IMSI");
      return { consumoMB: 0 };
    }

    const r = await req({
      method: "post",
      url: `${BASE_URL}/gcapi/device/sessionHistory`,
      data: {
        imsi: sim.imsi,
        start: 0,
        length: 1000,
      },
    });

    const sessions = r.data?.data || [];

    console.log("📊 SESIONES:", sessions.length);

    let totalBytes = 0;

    sessions.forEach((s) => {
      totalBytes += Number(s.totalBytes || 0);
    });

    return {
      consumoMB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    };

  } catch (e) {
    console.log("❌ ERROR CONSUMO:", e.message);
    return { consumoMB: 0 };
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
      fetchPlanFromSims(sim.iccid),
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

// 🔁 RESET
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
