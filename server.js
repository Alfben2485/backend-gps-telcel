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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NDczMjU1NDAxLCJ1c2VySWQiOjU3M30.IHBNI6Ss4187THcp35xTJzuKzY_P7D1aScaVJUaBzY5wIgVtYSTsU8ap2fCivL-LVS0CXc58yVi6TDpEzj45lA"; // 🔥 PON TU TOKEN

const LIMIT = 1000; // 🔥 CUÁNTOS TRAER DE CLARO
const MAX_RETURN = 100; // 🔥 CUÁNTOS MANDAR A KODULAR

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 ERROR FORMAT
function formatError(error) {
  return error?.response?.data || error?.message || "Error desconocido";
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

// 🔥 🔥 FUNCIÓN PRINCIPAL (FORMA CORRECTA)
async function fetchAllDevices() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: LIMIT, // 🔥 CLAVE (como Postman)
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const rawItems = response.data?.data || [];

  console.log("📊 TOTAL REAL:", response.data.recordsFiltered);
  console.log("📦 RECIBIDOS:", rawItems.length);

  const normalized = rawItems.map(normalizeDevice);

  return {
    total: response.data.recordsFiltered || normalized.length,
    data: normalized.slice(0, MAX_RETURN), // 🔥 limitar para Kodular
  };
}

// 🔹 BUSCAR SIM POR ICCID
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

  const items = response.data?.data || [];
  return items[0] || null;
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
    console.error("ERROR DEVICES:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
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

    res.json(normalizeDevice(item));
  } catch (error) {
    console.error("ERROR BUSCAR:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

// 🔹 START SERVER

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
