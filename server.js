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

// 🔥 PON TU TOKEN AQUÍ
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0NTYyOTQ1MzYzLCJ1c2VySWQiOjU3M30.y3MlkLoS5gblLXXiQ9BE47mDeXdySNOmhIwQurM_Spf63Brb8-BPtjpdzoEmlhrUriDcbauyIyG-GWwtW52G3Q";

const LIMIT = 1000; // lo que pides a Claro
const MAX_RETURN = 100; // lo que mandas a la app

// 🔹 HEADERS
function claroHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
}

// 🔹 FORMATEO DE ERRORES
function formatError(error) {
  return error?.response?.data || error?.message || "Error desconocido";
}

// 🔹 NORMALIZAR DATOS
function normalizeDevice(item = {}) {
  return {
    iccid: item.iccid || "",
    msisdn: item.msisdn || "",
    imsi: item.imsi || "",
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

// 🔥 OBTENER LISTA DE SIMS (LIMITADO)
async function fetchAllDevices() {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: LIMIT, // 🔥 igual que Postman
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

// 🔥 BUSCAR SIM POR ICCID (CORRECTO SEGÚN PDF)
async function fetchSimByIccid(iccid) {
  const response = await claroRequest({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: {
      iccids: [iccid], // 🔥 IMPORTANTE
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Error ${response.status}: ${JSON.stringify(response.data)}`
    );
  }

  const items =
    response.data?.devices ||
    response.data?.data ||
    [];

  return items[0] || null;
}

// 🔹 RUTAS

app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

// 🔥 LISTA DE SIMS (limitada para no romper Kodular)
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

// 🔥 BUSCAR SIM POR ICCID
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

// 🔥 CAMBIAR ESTADO DE SIM (EXTRA PRO)
app.put("/api/device/state", async (req, res) => {
  try {
    const { iccid, state, reason } = req.body;

    if (!iccid || !state) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar iccid y state",
      });
    }

    const sim = await fetchSimByIccid(iccid);

    if (!sim) {
      return res.status(404).json({
        ok: false,
        error: "SIM no encontrada",
      });
    }

    const response = await claroRequest({
      method: "post",
      url: `${BASE_URL}/gcapi/device/changeState`,
      data: {
        imsi: sim.imsi,
        newState: state,
        reason: reason || "Cambio desde app",
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(JSON.stringify(response.data));
    }

    res.json({
      ok: true,
      mensaje: "Estado cambiado correctamente",
      respuesta: response.data,
    });
  } catch (error) {
    console.error("ERROR ESTADO:", formatError(error));
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
