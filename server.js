const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 SSL fix (Claro)
const agent = new https.Agent({
  rejectUnauthorized: false
});

// 🌐 URL BASE CLARO
const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// 🔥 TOKEN FIJO (REEMPLAZA CON EL TUYO)
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0MzE2NDAzNDAzLCJ1c2VySWQiOjU3M30.qr7OWXXK09RHXVbZkWTIYSkNeGRWDXAGcUUdRSlFtsf56nZIFUD2AwXgHB6tURC5FcYcmYfbQ7_VH9M-yIdrhg";

// 🧪 TEST
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

// 📡 LISTAR TODAS LAS SIMS (paginado automático)
app.get("/api/devices", async (req, res) => {
  try {
    let allDevices = [];
    let pageNumber = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.post(
        `${BASE_URL}/gcapi/device/list`,
        { pageNumber, pageSize },
        {
          httpsAgent: agent,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      const items = response.data.data || [];
      const mapped = items.map(item => ({
        iccid: item.iccid,
        msisdn: item.msisdn,
        estado: item.state,
        plan: item.servicePlan?.servicePlanName || "N/A"
      }));

      allDevices = allDevices.concat(mapped);

      // Si recibimos menos de pageSize, ya no hay más páginas
      if (items.length < pageSize) {
        hasMore = false;
      } else {
        pageNumber++;
      }
    }

    res.json(allDevices);
  } catch (error) {
    console.error("ERROR DEVICES:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔎 BUSCAR SIM POR ICCID
app.get("/api/device/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const response = await axios.post(
      `${BASE_URL}/gcapi/get/sims`,
      { iccid },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const item = response.data.data[0];

    const resultado = {
      iccid: item.iccid,
      msisdn: item.msisdn,
      estado: item.state,
      plan: item.servicePlan?.servicePlanName || "N/A"
    };

    res.json(resultado);

  } catch (error) {
    console.error("ERROR BUSCAR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔄 CAMBIAR ESTADO SIM
app.put("/api/device/state", async (req, res) => {
  try {
    const { iccid, state } = req.body;

    const response = await axios.put(
      `${BASE_URL}/gcapi/device/changeState`,
      { iccid, state },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      ok: true,
      respuesta: response.data
    });

  } catch (error) {
    console.error("ERROR ESTADO:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 📊 USO DE DATOS
app.get("/api/device/usage/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const response = await axios.post(
      `${BASE_URL}/gcapi/sim/Data/Usage`,
      { iccid },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error("ERROR USAGE:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🚀 SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto " + PORT);
});
