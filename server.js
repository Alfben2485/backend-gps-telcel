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

// 🔥 TOKEN FIJO
const TOKEN = "PEGA_AQUI_TU_TOKEN_REAL";

// TEST
app.get("/", (req, res) => {
  res.send("Servidor funcionando 🚀");
});

// API TEST
app.get("/api/test", (req, res) => {
  res.json({ ok: true });
});

// DEVICES
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
    console.error("ERROR:", error.response?.data || error.message);

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

// PORT
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
