const express = require("express");
const axios = require("axios");
const https = require("https");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// SSL fix
const agent = new https.Agent({
  rejectUnauthorized: false
});

const BASE_URL = "https://cc.amx.claroconnect.com:8443";

// VARIABLES
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

let TOKEN = "";

// 🔐 LOGIN DEBUG REAL
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

    console.log("🔍 RESPUESTA COMPLETA:", response.data);

    // GUARDAR TODO COMO TOKEN TEMPORAL
    TOKEN = response.data.token || response.data.accessToken || response.data;

    console.log("TOKEN RAW:", TOKEN);

  } catch (error) {
    console.error("❌ ERROR LOGIN:", error.response?.data || error.message);
  }
}

// TEST
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
      respuestaCompleta: response.data
    });

  } catch (error) {
    res.json({
      error: error.response?.data || error.message
    });
  }
});

// SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo 🚀");
});
