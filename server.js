const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const agent = new https.Agent({
  rejectUnauthorized: false
});

const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// 🔐 VARIABLES
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

let TOKEN = "";

// 🔑 FUNCIÓN LOGIN
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

    TOKEN = response.data.token;
    console.log("Nuevo token obtenido");
  } catch (error) {
    console.error("Error al obtener token:", error.response?.data || error.message);
  }
}

// 🔁 OBTENER TOKEN AL INICIAR
getToken();

// 🧪 TEST
app.get("/api/test", (req, res) => {
  res.json({ ok: true, token: TOKEN ? "ACTIVO" : "VACÍO" });
});

// 📡 DISPOSITIVOS
app.get("/api/devices", async (req, res) => {
  try {
    if (!TOKEN) await getToken();

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
    console.error("ERROR:", error.response?.data || error.message);

    // 🔁 si token expiró, vuelve a intentar
    if (error.response?.data?.identificationCode === 1005) {
      await getToken();

      return res.json({ ok: false, retry: true, message: "Token renovado, intenta otra vez" });
    }

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// 🚀 SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo 🚀");
});
