const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");
const qs = require("qs");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 SSL fix (Claro)
const agent = new https.Agent({
  rejectUnauthorized: false
});

// 🌐 URL BASE CLARO
const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// 🔑 VARIABLES (Railway)
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

let TOKEN = "";

// 🔐 FUNCIÓN PARA OBTENER TOKEN (FORM DATA)
async function getToken() {
  try {
    const response = await axios.post(
      `${BASE_URL}/gcapi/auth`,
      qs.stringify({
        username: USERNAME,
        password: PASSWORD
      }),
      {
        httpsAgent: agent,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log("🔍 LOGIN RESPONSE:", response.data);

    // 🔥 DETECTAR TOKEN
    if (response.data.token) {
      TOKEN = response.data.token;
    } else if (response.data.accessToken) {
      TOKEN = response.data.accessToken;
    } else if (response.data.result?.token) {
      TOKEN = response.data.result.token;
    } else {
      TOKEN = "";
    }

    console.log("✅ TOKEN:", TOKEN ? "OK" : "VACÍO");

  } catch (error) {
    console.error("❌ ERROR LOGIN:", error.response?.data || error.message);
  }
}

// 🔁 FUNCIÓN CON REINTENTO AUTOMÁTICO
async function requestWithRetry(config) {
  try {
    return await axios(config);
  } catch (error) {
    if (error.response?.data?.identificationCode === 1005) {
      console.log("🔄 Token expirado, renovando...");
      await getToken();

      config.headers.Authorization = `Bearer ${TOKEN}`;
      return await axios(config);
    }
    throw error;
  }
}

// 🧪 TEST LOGIN
app.get("/api/test", async (req, res) => {
  try {
    await getToken();

    res.json({
      ok: true,
      token: TOKEN ? "ACTIVO" : "VACÍO"
    });

  } catch (error) {
    res.json({
      ok: false,
      error: error.message
    });
  }
});

// 📡 LISTAR DISPOSITIVOS
app.get("/api/devices", async (req, res) => {
  try {
    if (!TOKEN) {
      await getToken();
    }

    const response = await requestWithRetry({
      method: "POST",
      url: `${BASE_URL}/gcapi/device/list`,
      data: {},
      httpsAgent: agent,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json(response.data);

  } catch (error) {
    console.error("❌ ERROR DEVICES:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🔎 BUSCAR POR ICCID
app.get("/api/device/:iccid", async (req, res) => {
  try {
    const { iccid } = req.params;

    const response = await requestWithRetry({
      method: "POST",
      url: `${BASE_URL}/gcapi/get/sims`,
      data: { iccid },
      httpsAgent: agent,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json(response.data);

  } catch (error) {
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

    const response = await requestWithRetry({
      method: "PUT",
      url: `${BASE_URL}/gcapi/device/changeState`,
      data: { iccid, state },
      httpsAgent: agent,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json(response.data);

  } catch (error) {
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

    const response = await requestWithRetry({
      method: "POST",
      url: `${BASE_URL}/gcapi/sim/Data/Usage`,
      data: { iccid },
      httpsAgent: agent,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json(response.data);

  } catch (error) {
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
