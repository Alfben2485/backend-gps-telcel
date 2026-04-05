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


// =========================
// 🔥 CUENTA ORIGINAL (NO TOCAR)
// =========================
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";

let TOKEN = null;
let TOKEN_TIME = 0;


// =========================
// 🔥 CUENTAS EXTRA
// =========================
const ACCOUNTS_EXTRA = {
  cuenta2: {
    username: "alfben2",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
  cuenta3: {
    username: "alfben4",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
};

const TOKEN_DURATION = 50 * 60 * 1000;


// =========================
// 🔐 TOKEN ORIGINAL
// =========================
async function getToken() {
  const r = await axios({
    httpsAgent: agent,
    method: "post",
    url: `${BASE_URL}/gcapi/auth`,
    data: { username: USERNAME, password: PASSWORD },
  });

  TOKEN = r.data?.token;
  TOKEN_TIME = Date.now();
}

async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}


// =========================
// 🔐 TOKEN EXTRA
// =========================
async function ensureTokenExtra(key) {
  const acc = ACCOUNTS_EXTRA[key];

  if (!acc.token || Date.now() - acc.tokenTime > TOKEN_DURATION) {
    const r = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: {
        username: acc.username,
        password: acc.password,
      },
    });

    acc.token = r.data?.token;
    acc.tokenTime = Date.now();
  }
}


// =========================
// 🔥 REQUEST ORIGINAL
// =========================
async function claroRequest(config) {
  await ensureToken();

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}


// =========================
// 🔥 REQUEST EXTRA
// =========================
async function claroRequestExtra(key, config) {
  await ensureTokenExtra(key);

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${ACCOUNTS_EXTRA[key].token}`,
      "Content-Type": "application/json",
    },
  });
}


// =========================
// 🔹 FUNCIONES GENERALES
// =========================
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

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

  return { start: format(start), end: format(end) };
}


// =========================
// 🔥 FUNCIONES CORE
// =========================
async function fetchSim(request, value) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 10,
      search: { value },
    },
  });

  const items = r.data?.data || [];

  return items.find(
    (i) =>
      String(i.iccid).trim() === String(value).trim() ||
      String(i.msisdn).trim() === String(value).trim()
  );
}

async function getSimExtra(request, sim) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { msisdn: sim.msisdn },
  });

  const device = (r.data?.devices || []).find(
    (d) => String(d.iccid) === String(sim.iccid)
  );

  return {
    imsi: device?.imsi,
    plan: device?.devicePlans?.planName || "N/A",
  };
}

async function getTotalSims(request) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: { start: 0, length: 1 },
  });

  return r.data?.recordsFiltered || 0;
}


// =========================
// 🔥 CONSUMO (NO TOCAR)
// =========================
async function fetchUsage(request, imsi) {
  if (!imsi) return { consumoMB: 0 };

  const { start, end } = getDateRange();

  let total = 0;

  const days = [];
  let current = new Date(start);

  while (current <= new Date(end)) {
    days.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  const chunkSize = 5;

  for (let i = 0; i < days.length; i += chunkSize) {
    const chunk = days.slice(i, i + chunkSize);

    const results = await Promise.all(
      chunk.map((d) =>
        Promise.all([
          request({
            method: "post",
            url: `${BASE_URL}/gcapi/simUplink/usage`,
            data: { imsi, startDate: d, endDate: d },
          }).catch(() => null),

          request({
            method: "post",
            url: `${BASE_URL}/gcapi/simDownlink/usage`,
            data: { imsi, startDate: d, endDate: d },
          }).catch(() => null),
        ])
      )
    );

    for (const [up, down] of results) {
      (up?.data?.object || []).forEach(
        (i) => (total += Number(i["totalBytes(MB)"] || 0))
      );
      (down?.data?.object || []).forEach(
        (i) => (total += Number(i["totalBytes(MB)"] || 0))
      );
    }
  }

  return { consumoMB: Number(total.toFixed(3)) };
}


// =========================
// 🔥 ENDPOINTS
// =========================

// CUENTA 1
app.get("/api/device/full/:value", async (req, res) => {
  try {
    const sim = await fetchSim(claroRequest, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(claroRequest, sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(claroRequest, imsi),
      getTotalSims(claroRequest),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state,
      plan: extra.plan,
      consumoMB: consumo.consumoMB,
    });

  } catch {
    res.json({ ok: false });
  }
});


// CUENTA 2
app.get("/api2/device/full/:value", async (req, res) => {
  try {
    const req2 = (cfg) => claroRequestExtra("cuenta2", cfg);

    const sim = await fetchSim(req2, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(req2, sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(req2, imsi),
      getTotalSims(req2),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state,
      plan: extra.plan,
      consumoMB: consumo.consumoMB,
    });

  } catch {
    res.json({ ok: false });
  }
});


// CUENTA 3
app.get("/api3/device/full/:value", async (req, res) => {
  try {
    const req3 = (cfg) => claroRequestExtra("cuenta3", cfg);

    const sim = await fetchSim(req3, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(req3, sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const [consumo, totalSims] = await Promise.all([
      fetchUsage(req3, imsi),
      getTotalSims(req3),
    ]);

    res.json({
      ok: true,
      totalSims,
      iccid: sim.iccid,
      msisdn: sim.msisdn,
      estado: sim.state,
      plan: extra.plan,
      consumoMB: consumo.consumoMB,
    });

  } catch {
    res.json({ ok: false });
  }
});


// =========================
// 🔁 RESET
// =========================

// CUENTA 1
app.post("/api/device/reset/:value", async (req, res) => {
  try {
    const sim = await fetchSim(claroRequest, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(claroRequest, sim);
    const imsi = extra.imsi || extractIMSI(sim);

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


// CUENTA 2
app.post("/api2/device/reset/:value", async (req, res) => {
  try {
    const req2 = (cfg) => claroRequestExtra("cuenta2", cfg);

    const sim = await fetchSim(req2, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(req2, sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const r = await req2({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi },
    });

    res.json({ ok: true, data: r.data });

  } catch {
    res.json({ ok: false });
  }
});


// CUENTA 3
app.post("/api3/device/reset/:value", async (req, res) => {
  try {
    const req3 = (cfg) => claroRequestExtra("cuenta3", cfg);

    const sim = await fetchSim(req3, req.params.value);
    if (!sim) return res.json({ ok: false });

    const extra = await getSimExtra(req3, sim);
    const imsi = extra.imsi || extractIMSI(sim);

    const r = await req3({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/reset`,
      data: { imsi },
    });

    res.json({ ok: true, data: r.data });

  } catch {
    res.json({ ok: false });
  }
});


// =========================
// 🚀 START
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SERVER MULTICUENTA OK");
});
