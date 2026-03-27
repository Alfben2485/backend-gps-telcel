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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NTYyOTQ1MzYzLCJ1c2VySWQiOjU3M30.y3MlkLoS5gblLXXiQ9BE47mDeXdySNOmhIwQurM_Spf63Brb8-BPtjpdzoEmlhrUriDcbauyIyG-GWwtW52G3Q"; // 🔥 PON TU TOKEN

const LIMIT = 1000; // 🔥 trae muchas sims de Claro
const MAX_RETURN = 100; // 🔥 limita lo que mandas a la app

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
    timeout: 60000,
    validateStatus: () => true,
    ...config,
    headers: {
      ...claroHeaders(),
      ...(config.headers || {}),
    },
  });
}

// 🔹 NORMALIZAR DATOS
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

// 🔥 OBTENER TODAS LAS SIMS (como Postman)
async function fetchAllDevices() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: LIMIT,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const rawItems = response.data?.data || [];

  console.log("📊 TOTAL:", response.data.recordsFiltered);
  console.log("📦 RECIBIDOS:", rawItems.length);

  const normalized = rawItems.map(normalizeDevice);

  return {
    total: response.data.recordsFiltered || normalized.length,
    data: normalized.slice(0, MAX_RETURN),
  };
}

// 🔥 BUSCAR SIM POR ICCID (CORREGIDO)
async function fetchSimByIccid(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: LIMIT,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const items = response.data?.data || [];

  const found = items.find(
    (item) =>
      String(item.iccid).trim() === String(iccid).trim()
  );

  return found ? normalizeDevice(found) : null;
}

// 🔹 RUTAS

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

// 🔥 OBTENER SIMS
app.get("/api/devices", async (req, res) => {
  try {
    const result = await fetchAllDevices();
    res.json(result);
  } catch (error) {
    console.error("ERROR DEVICES:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔥 BUSCAR SIM
app.get("/api/device/:iccid", async (req, res) => {
  try {
    const item = await fetchSimByIccid(req.params.iccid);

    if (!item) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    res.json(item);
  } catch (error) {
    console.error("ERROR BUSCAR:", error.message);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// 🔹 START SERVER

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
