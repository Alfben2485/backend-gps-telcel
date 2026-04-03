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

// BUSCAR SIM
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

  } catch {
    return null;
  }
}

// EXTRA DATA (PLAN + IMSI)
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

  } catch {
    return {};
  }
}

// FECHAS
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

// 🔥 CONSUMO DEFINITIVO
async function fetchUsage(imsi) {
  try {
    if (!imsi) return { consumoMB: 0 };

    const { startDate, endDate } = getDateRange();

    // 🔥 1. SESSION HISTORY
    try {
      const r = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/device/sessionHistory`,
        data: {
          imsi,
          startDate,
          endDate,
          start: 0,
          length: 200,
        },
      });

      const sessions = r.data?.data || [];

      let totalBytes = 0;

      sessions.forEach((s) => {
        totalBytes += Number(s.totalBytes || 0);
      });

      if (totalBytes > 0) {
        return { consumoMB: Number((totalBytes / (1024 * 1024)).toFixed(2)) };
      }

    } catch {}

    // 🔥 2. UPLINK
    try {
      const r = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/simUplink/usage`,
        data: { imsi, startDate, endDate },
      });

      const data = r.data?.object || [];

      let total = 0;
      data.forEach((d) => {
        total += Number(d["totalBytes(MB)"] || 0);
      });

      if (total > 0) return { consumoMB: total };

    } catch {}

    // 🔥 3. DOWNLINK
    try {
      const r = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/simDownlink/usage`,
        data: { imsi, startDate, endDate },
      });

      const data = r.data?.object || [];

      let total = 0;
      data.forEach((d) => {
        total += Number(d["totalBytes(MB)"] || 0);
      });

      if (total > 0) return { consumoMB: total };

    } catch {}

    // 🔥 4. CONSUMED
    try {
      const r = await claroRequest({
        method: "post",
        url: `${BASE_URL}/gcapi/consumed/usage`,
        data: { imsi },
      });

      const total = Number(r.data?.totalMB || 0);

      if (total > 0) return { consumoMB: total };

    } catch {}

    return { consumoMB: 0 };

  } catch {
    return { consumoMB: 0 };
  }
}

// ENDPOINT
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);
    if (!sim) return res.json({ ok: false });

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

  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// RESET
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtraData(sim);
    const imsi = extra.imsi || sim.imsi;

    const r = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi },
    });

    res.json({ ok: true, data: r.data });

  } catch {
    res.json({ ok: false });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Servidor listo");
});
