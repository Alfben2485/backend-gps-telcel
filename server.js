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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0MzE2NDAzNDAzLCJ1c2VySWQiOjU3M30.qr7OWXXK09RHXVbZkWTIYSkNeGRWDXAGcUUdRSlFtsf56nZIFUD2AwXgHB6tURC5FcYcmYfbQ7_VH9M-yIdrhg";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 500;
const DEFAULT_REASON = "Cambio realizado desde panel web";

function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

function formatError(error) {
  return error?.response?.data || error?.message || "Error desconocido";
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const clean = value.replace(/,/g, "").trim();
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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
    payload?.items,
    payload?.results,
    payload?.content,
    payload?.rows,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || item.simIccid || "",
    msisdn: item.msisdn || item.phoneNumber || "",
    imsi: item.imsi || item.imsiNumber || "",
    estado: item.state || item.estado || item.status || "N/A",
    plan:
      item.servicePlan?.servicePlanName ||
      item.plan ||
      item.ratePlanName ||
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

const paginationStrategies = [
  {
    name: "body_pageNumber_pageSize",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { pageNumber: page, pageSize: size },
    }),
  },
  {
    name: "body_page_limit",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { page, limit: size },
    }),
  },
  {
    name: "body_currentPage_perPage",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { currentPage: page, perPage: size },
    }),
  },
  {
    name: "body_offset_limit",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list`,
      data: { offset: (page - 1) * size, limit: size },
    }),
  },
  {
    name: "query_pageNumber_pageSize",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list?pageNumber=${page}&pageSize=${size}`,
      data: {},
    }),
  },
  {
    name: "query_page_limit",
    build: (page, size) => ({
      method: "post",
      url: `${BASE_URL}/gcapi/device/list?page=${page}&limit=${size}`,
      data: {},
    }),
  },
];

async function detectBestPaginationStrategy(pageSize) {
  const results = [];

  for (const strategy of paginationStrategies) {
    try {
      const response = await claroRequest(strategy.build(1, pageSize));
      const items = response.status >= 200 && response.status < 300
        ? extractArray(response.data)
        : [];

      results.push({
        name: strategy.name,
        count: items.length,
      });
    } catch (error) {
      results.push({
        name: strategy.name,
        count: 0,
      });
    }
  }

  results.sort((a, b) => b.count - a.count);
  console.log("PAGINATION TEST:", results);

  const best = results[0];
  return paginationStrategies.find((s) => s.name === best.name) || paginationStrategies[0];
}

async function fetchAllDevices(pageSize = DEFAULT_PAGE_SIZE) {
  const bestStrategy = await detectBestPaginationStrategy(pageSize);
  const map = new Map();

  console.log("PAGINATION USING:", bestStrategy.name);

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await claroRequest(bestStrategy.build(page, pageSize));

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Claro respondió ${response.status}: ${JSON.stringify(response.data)}`
      );
    }

    const rawItems = extractArray(response.data);
    const devices = rawItems.map(normalizeDevice).filter((item) => item.iccid);

    let added = 0;
    for (const device of devices) {
      if (!map.has(device.iccid)) {
        map.set(device.iccid, device);
        added++;
      }
    }

    console.log(
      `PAGE ${page} -> recibidos: ${rawItems.length}, agregados: ${added}, total acumulado: ${map.size}`
    );

    if (rawItems.length === 0) break;
    if (rawItems.length < pageSize) break;
    if (added === 0) break;
  }

  return Array.from(map.values());
}

async function fetchSimByIccid(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { iccid },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Claro respondió ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const items = extractArray(response.data);
  return items[0] || null;
}

async function changeClaroState({ iccid, state, reason }) {
  const sim = await fetchSimByIccid(iccid);

  if (!sim) {
    throw new Error(`No se encontró la SIM con ICCID ${iccid}`);
  }

  const imsi = sim.imsi || sim.imsiNumber;

  const attempts = [
    {
      method: "put",
      url: `${BASE_URL}/gcapi/device/changeState`,
      data: { imsi, newState: state, reason },
    },
    {
      method: "post",
      url: `${BASE_URL}/gcapi/device/changeState`,
      data: { imsi, newState: state, reason },
    },
    {
      method: "put",
      url: `${BASE_URL}/gcapi/device/changeState`,
      data: { iccid, state },
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    const response = await claroRequest(attempt);

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }

    lastError = new Error(
      `Claro respondió ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  throw lastError || new Error("No fue posible cambiar el estado");
}

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/devices", async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    const devices = await fetchAllDevices(pageSize);
    res.json(devices);
  } catch (error) {
    console.error("ERROR DEVICES:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

app.get("/api/device/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;
    const item = await fetchSimByIccid(iccid);

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    res.json(normalizeDevice(item));
  } catch (error) {
    console.error("ERROR BUSCAR:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

app.put("/api/device/state", async (req, res) => {
  try {
    const { iccid, state, reason } = req.body;

    if (!iccid || !state) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar iccid y state",
      });
    }

    const respuesta = await changeClaroState({
      iccid,
      state,
      reason: reason || DEFAULT_REASON,
    });

    res.json({
      ok: true,
      respuesta,
    });
  } catch (error) {
    console.error("ERROR ESTADO:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

app.get("/api/device/usage/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: { iccid },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Claro respondió ${response.status}: ${JSON.stringify(response.data)}`
      );
    }

    const usageData = response.data?.data || response.data || {};
    const totalKB = toNumber(
      usageData.totalBytes ??
      usageData.totalKB ??
      usageData.kb ??
      usageData.usageKB ??
      0
    );
    const totalMB = Number((totalKB / 1024).toFixed(2));

    res.json({
      ...response.data,
      totalKB,
      totalMB,
      unidad: "MB",
    });
  } catch (error) {
    console.error("ERROR USAGE:", formatError(error));
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
