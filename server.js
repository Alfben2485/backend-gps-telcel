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

// 🔑 VARIABLES (Railway)
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

let TOKEN = "";

// 🔐 FUNCIÓN PARA OBTENER TOKEN
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
    console.log("✅ Token obtenido correctamente");
  } catch (error) {
    console.error("❌ Error obteniendo token:", error.response?.data || error.message);
  }
}

// 🔁 OBTENER TOKEN AL INICIAR
getToken();

// 🧪 TEST
app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    token: TOKEN ? "ACTIVO" : "VACÍO"
  });
});

// 📡 LISTAR DISPOSITIVOS
app.get("/api/devices", async (req, res) => {
  try {
    let response;

    try {
      response = await axios.post(
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
    } catch (error) {
      // 🔁 si token expiró
      if (error.response?.data?.identificationCode === 1005) {
        console.log("🔄 Token expirado, renovando...");
        await getToken();

        response = await axios.post(
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
      } else {
        throw error;
      }
    }

    res.json(response.data);

  } catch (error) {
    console.error("❌ ERROR FINAL:", error.response?.data || error.message);

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

    let response;

    try {
      response = await axios.post(
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
    } catch (error) {
      if (error.response?.data?.identificationCode === 1005) {
        await getToken();

        response = await axios.post(
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
      } else {
        throw error;
      }
    }

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

    let response;

    try {
      response = await axios.put(
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
    } catch (error) {
      if (error.response?.data?.identificationCode === 1005) {
        await getToken();

        response = await axios.put(
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
      } else {
        throw error;
      }
    }

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

    let response;

    try {
      response = await axios.post(
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
    } catch (error) {
      if (error.response?.data?.identificationCode === 1005) {
        await getToken();

        response = await axios.post(
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
      } else {
        throw error;
      }
    }

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
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
