const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 Config SSL (evita error de certificado de Claro)
const agent = new https.Agent({
  rejectUnauthorized: false
});

// 🔑 Variables de entorno (Railway)
const BASE_URL = "https://cc.amx.claroconnect.com:8443";
const TOKEN = process.env.TOKEN;

// 🔍 TEST
app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "Backend funcionando 🚀" });
});

// 📡 OBTENER DISPOSITIVOS / SIMS
app.get("/api/devices", async (req, res) => {
  try {
    const response = await axios.post(
      `${BASE_URL}/gcapi/device/list`,
      {}, // body vacío (ajustable si Claro pide filtros)
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
    console.error("ERROR:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔎 BUSCAR POR ICCID (opcional)
app.get("/api/device/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const response = await axios.post(
      `${BASE_URL}/gcapi/get/sims`,
      {
        iccid: iccid
      },
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
    console.error("ERROR:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔄 CAMBIAR ESTADO SIM (ACTIVAR / SUSPENDER)
app.put("/api/device/state", async (req, res) => {
  try {
    const { iccid, state } = req.body;

    const response = await axios.put(
      `${BASE_URL}/gcapi/device/changeState`,
      {
        iccid: iccid,
        state: state // ACTIVE / SUSPENDED
      },
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
    console.error("ERROR:", error.response?.data || error.message);
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
      {
        iccid: iccid
      },
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
    console.error("ERROR:", error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🚀 SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
