const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔐 SSL fix
const agent = new https.Agent({
  rejectUnauthorized: false
});

// 🌐 URL CLARO
const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// 🔑 VARIABLES
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

let TOKEN = "";

// 🔐 OBTENER TOKEN
async function getToken() {
  try {
    const response = await axios.post(
      `${BASE_URL}/gcapi/auth`,
      {
        username: USERNAME,
        password: PASSWORD
      },
      {
        httpsAgent: agent,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    console.log("🔍 RESPUESTA LOGIN:", response.data);

    // 🔥 DETECCIÓN FLEXIBLE
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

// 🔁 FUNCIÓN CON REINTENTO
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

// 🧪 DEBUG LOGIN (IMPORTANTE)
app.get("/api/test", async (req, res) => {
  try {
    const response = await axios.post(
      `${BASE_URL}/gcapi/auth`,
      {
        username: USERNAME,
        password: PASSWORD
      },
      {
        httpsAgent: agent,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      loginResponse: response.data
    });

  } catch (error) {
    res.json({
      error: error.response?.data || error.message
    });
  }
});

// 📡 DEVICES
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
    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🚀 SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo");
});
