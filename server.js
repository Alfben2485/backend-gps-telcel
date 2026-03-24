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
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0MzE2NDAzNDAzLCJ1c2VySWQiOjU3M30.qr7OWXXK09RHXVbZkWTIYSkNeGRWDXAGcUUdRSlFtsf56nZIFUD2AwXgHB6tURC5FcYcmYfbQ7_VH9M-yIdrhg"; // 🔥 PON TU TOKEN

const LIMIT = 1000; // 🔥 IGUAL QUE POSTMAN

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
  return payload?.data || [];
}

function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || "",
    msisdn: item.msisdn || "",
    estado: item.state || item.status || "N/A",
    plan: item.servicePlan?.servicePlanName || "N/A",
  };
}

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

// 🔥 🔥 NUEVA FUNCIÓN (TIPO POSTMAN)
async function fetchAllDevices() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: LIMIT, // 🔥 CLAVE
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const rawItems = extractArray(response.data);

  console.log("TOTAL API:", response.data.recordsFiltered);
  console.log("RECIBIDOS:", rawItems.length);

  return {
    total: response.data.recordsFiltered || rawItems.length,
    data: rawItems.map(normalizeDevice),
  };
}

// 🔹 RUTAS

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/devices", async (req, res) => {
  try {
    const result = await fetchAllDevices();
    res.json(result);
  } catch (error) {
    console.error("ERROR:", formatError(error));
    res.status(500).json({
      ok: false,
      error: formatError(error),
    });
  }
});

// 🔹 START

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
