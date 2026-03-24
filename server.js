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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0MzE2NDAzNDAzLCJ1c2VySWQiOjU3M30.qr7OWXXK09RHXVbZkWTIYSkNeGRWDXAGcUUdRSlFtsf56nZIFUD2AwXgHB6tURC5FcYcmYfbQ7_VH9M-yIdrhg"; // ⚠️ PON TU TOKEN

const PAGE_SIZE = 100; // 🔥 FORZADO A 100
const MAX_PAGES = 50; // 🔥 evita sobrecarga

function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

function formatError(error) {
  return error?.response?.data || error?.message || "Error desconocido";
}

function extractArray(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.results,
    payload?.data?.content,
    payload?.data?.rows,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || "",
    msisdn: item.msisdn || "",
    estado: item.state || item.status || "N/A",
    plan:
      item.servicePlan?.servicePlanName ||
      item.plan ||
      "N/A",
  };
}

async function claroRequest(config) {
  return axios({
    httpsAgent: agent,
    timeout: 30000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...claroHeaders(),
      ...(config.headers || {}),
    },
  });
}

async function fetchAllDevices() {
  const map = new Map();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {
        pageNumber: page,
        pageSize: PAGE_SIZE,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Error ${response.status}: ${JSON.stringify(response.data)}`
      );
    }

    const rawItems = extractArray(response.data);
    const devices = rawItems.map(normalizeDevice).filter(d => d.iccid);

    let added = 0;

    for (const d of devices) {
      if (!map.has(d.iccid)) {
        map.set(d.iccid, d);
        added++;
      }
    }

    console.log(`Página ${page}: ${rawItems.length} recibidos`);

    // 🔥 cortar si ya no hay más datos
    if (rawItems.length === 0) break;
    if (rawItems.length < PAGE_SIZE) break;
  }

  // 🔥 SOLO REGRESAR 100 PARA KODULAR
  return Array.from(map.values()).slice(0, 100);
}

async function fetchSimByIccid(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { iccid },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const items = extractArray(response.data);
  return items[0] || null;
}

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/devices", async (req, res) => {
  try {
    const devices = await fetchAllDevices();
    res.json(devices);
  } catch (error) {
    console.error("ERROR:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

app.get("/api/device/:iccid", async (req, res) => {
  try {
    const item = await fetchSimByIccid(req.params.iccid);

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    res.json(normalizeDevice(item));
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
