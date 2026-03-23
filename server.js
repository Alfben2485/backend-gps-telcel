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

// 🔥 ⚠️ PEGA AQUÍ TU TOKEN REAL (EL QUE SÍ FUNCIONABA)
const TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhbGZiZW4iLCJhY2NvdW50SWQiOjc4OSwiYXVkaWVuY2UiOiJ3ZWIiLCJjcmVhdGVkIjoxNzc0MTQxNzA4MjA4LCJ1c2VySWQiOjU3M30.cx6lj3ksBNOAC3CZ_ygRzWLu86UZPcIji_P1G7VXiyquHMh0MerZRsf8hCqB_H7hfzw_LYyahdJQrXmvaVvYOQ";

// 🧪 TEST
app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    mensaje: "Backend funcionando correctamente"
  });
});

// 📡 LISTAR DISPOSITIVOS
app.get("/api/devices", async (req, res) => {
  try {
    const response = await axios.post(
      `${BASE_URL}/gcapi/device/list`,
      {},
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
    console.error("❌ ERROR DEVICES:", error.response?.data || error.message);

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

    res.json(response.data);

  } catch (error) {
    console.error("❌ ERROR BUSCAR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔄 ACTIVAR / SUSPENDER SIM
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

    res.json(response.data);

  } catch (error) {
    console.error("❌ ERROR ESTADO:", error.response?.data || error.message);

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
    console.error("❌ ERROR USAGE:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🚀 SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
