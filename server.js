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

// =========================
//  CUENTA ORIGINAL
// =========================
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";

let TOKEN = null;
let TOKEN_TIME = 0;

// =========================
//  CUENTAS EXTRA
// =========================
const ACCOUNTS_EXTRA = {
  cuenta2: {
    username: "alfben2",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
  cuenta3: {
    username: "alfben4",
    password: "Soporte122@",
    token: null,
    tokenTime: 0,
  },
};

const TOKEN_DURATION = 50 * 60 * 1000;

// =========================
//  TOKEN ORIGINAL
// =========================
async function getToken() {
  const r = await axios({
    httpsAgent: agent,
    method: "post",
    url: `${BASE_URL}/gcapi/auth`,
    data: { username: USERNAME, password: PASSWORD },
  });

  TOKEN = r.data?.token;
  TOKEN_TIME = Date.now();
  console.log("🔑 Token actualizado");
}

async function ensureToken() {
  if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) {
    await getToken();
  }
}

// =========================
//  TOKEN EXTRA
// =========================
async function ensureTokenExtra(key) {
  const acc = ACCOUNTS_EXTRA[key];

  if (!acc.token || Date.now() - acc.tokenTime > TOKEN_DURATION) {
    const r = await axios({
      httpsAgent: agent,
      method: "post",
      url: `${BASE_URL}/gcapi/auth`,
      data: {
        username: acc.username,
        password: acc.password,
      },
    });

    acc.token = r.data?.token;
    acc.tokenTime = Date.now();
    console.log(`🔑 Token extra (${key}) actualizado`);
  }
}

// =========================
//  REQUEST
// =========================
async function claroRequest(config) {
  await ensureToken();

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

async function claroRequestExtra(key, config) {
  await ensureTokenExtra(key);

  return axios({
    httpsAgent: agent,
    timeout: 15000,
    ...config,
    headers: {
      Authorization: `Bearer ${ACCOUNTS_EXTRA[key].token}`,
      "Content-Type": "application/json",
    },
  });
}

// =========================
//  FUNCIONES GENERALES
// =========================
function extractIMSI(item) {
  return (
    item.imsi ||
    item.subscription?.imsi ||
    item.sim?.imsi ||
    item.deviceInfo?.imsi ||
    null
  );
}

// =========================
//  CACHE (2 minutos)
// =========================
const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;

// =========================
//  FACTOR DE CORRECCIÓN GLOBAL
// =========================
const FACTOR_GLOBAL = 1.902;

const FACTORES_POR_ICCID = {
  // "8952020923346156758": 1.902,
};

// =========================
//  CONSUMO DÍA POR DÍA + FACTOR
// =========================
async function fetchUsage(request, imsi, iccid) {
  if (!imsi) return { consumoMB: 0 };

  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    console.log(`⚡ Caché para IMSI ${imsi} → ${cached.data.consumoMB} MB`);
    return cached.data;
  }

  const now = new Date();
  let start, end;

  if (now.getDate() >= 27) {
    start = new Date(now.getFullYear(), now.getMonth(), 27);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 25);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 27);
    end = new Date(now.getFullYear(), now.getMonth(), 25);
  }

  const format = (d) => d.toISOString().split("T")[0];

  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(format(new Date(d)));
  }

  let totalMB = 0;
  const BATCH_SIZE = 6;

  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.flatMap(date => [
        request({
          method: "post",
          url: `${BASE_URL}/gcapi/simUplink/usage`,
          data: { imsi, startDate: date, endDate: date }
        }).catch(() => null),
        request({
          method: "post",
          url: `${BASE_URL}/gcapi/simDownlink/usage`,
          data: { imsi, startDate: date, endDate: date }
        }).catch(() => null)
      ])
    );
    for (const res of results) {
      if (res && res.data && res.data.object) {
        for (const day of res.data.object) {
          totalMB += Number(day["totalBytes(MB)"] ?? day["totalbytes(MB)"] ?? 0);
        }
      }
    }
  }

  try {
    const sessionRes = await request({
      method: "post",
      url: `${BASE_URL}/gcapi/device/sessionHistory`,
      data: { imsi, startDate: format(start), endDate: format(end) }
    });
    const sessions = sessionRes.data?.data || [];
    let sessionMB = 0;
    for (const s of sessions) {
      sessionMB += Number(s.totalBytes || 0) / (1024 * 1024);
    }
    if (sessionMB > 0) {
      totalMB += sessionMB;
    }
  } catch (err) {
    console.log("⚠️ sessionHistory falló");
  }

  const factor = FACTORES_POR_ICCID[iccid] || FACTOR_GLOBAL;
  const consumoFinal = totalMB * factor;
  const rounded = Number(consumoFinal.toFixed(3));

  console.log(`📊 Consumo base API: ${totalMB.toFixed(3)} MB → Factor ${factor} → Consumo final: ${rounded} MB`);

  const result = { consumoMB: rounded };
  usageCache.set(imsi, { time: Date.now(), data: result });
  return result;
}

// =========================
//  CORE (sin cambios)
// =========================
async function fetchSim(request, value) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: {
      start: 0,
      length: 10,
      search: { value },
    },
  });

  const items = r.data?.data || [];

  return items.find(
    (i) =>
      String(i.iccid).trim() === String(value).trim() ||
      String(i.msisdn).trim() === String(value).trim()
  );
}

async function getSimExtra(request, sim) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/get/sims`,
    data: { msisdn: sim.msisdn },
  });

  const device = (r.data?.devices || []).find(
    (d) => String(d.iccid) === String(sim.iccid)
  );

  return {
    imsi: device?.imsi,
    plan: device?.devicePlans?.planName || "N/A",
  };
}

async function getTotalSims(request) {
  const r = await request({
    method: "post",
    url: `${BASE_URL}/gcapi/device/list`,
    data: { start: 0, length: 1 },
  });

  return r.data?.recordsFiltered || 0;
}

// =========================
//  ENDPOINTS + RESET
// =========================
function buildEndpoint(path, requestFn) {
  app.get(path, async (req, res) => {
    const timeout = setTimeout(() => res.json({ ok: false, error: "Timeout" }), 25000);
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) {
        clearTimeout(timeout);
        return res.json({ ok: false, error: "SIM no encontrada" });
      }

      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);

      const [consumo, totalSims] = await Promise.all([
        fetchUsage(requestFn, imsi, sim.iccid),
        getTotalSims(requestFn),
      ]);

      clearTimeout(timeout);
      res.json({
        ok: true,
        totalSims,
        iccid: sim.iccid,
        msisdn: sim.msisdn,
        estado: sim.state,
        plan: extra.plan,
        consumoMB: consumo.consumoMB,
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error("Error en endpoint:", error.message);
      res.json({ ok: false, error: error.message });
    }
  });
}

function buildReset(path, requestFn) {
  app.post(path, async (req, res) => {
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) return res.json({ ok: false, error: "SIM no encontrada" });

      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);

      const r = await requestFn({
        method: "post",
        url: `${BASE_URL}/gcapi/sim/reset`,
        data: { imsi },
      });

      res.json({ ok: true, data: r.data });
    } catch (error) {
      console.error("Error en reset:", error.message);
      res.json({ ok: false, error: error.message });
    }
  });
}

buildEndpoint("/api/device/full/:value", claroRequest);
buildEndpoint("/api2/device/full/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildEndpoint("/api3/device/full/:value", (cfg) => claroRequestExtra("cuenta3", cfg));

buildReset("/api/device/reset/:value", claroRequest);
buildReset("/api2/device/reset/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildReset("/api3/device/reset/:value", (cfg) => claroRequestExtra("cuenta3", cfg));

// =========================
//  INTEGRACIÓN CON HOLOGRAM (TOKEN ACTUALIZADO)
// =========================
// Token proporcionado: YXBpa2V5OjZKSVlEcVF0VXpwcGZFcmVxeENLSE1RWExJMWt2Yg==
const HOLOGRAM_API_TOKEN = "YXBpa2V5OjZKSVlEcVF0VXpwcGZFcmVxeENLSE1RWExJMWt2Yg==";

async function hologramRequest(endpoint, method = 'GET', body = null) {
  const config = {
    method: method,
    url: `https://dashboard.hologram.io/api/1/${endpoint}`,
    headers: {
      'Authorization': `Basic ${HOLOGRAM_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000,
    httpsAgent: agent
  };
  if (body) {
    config.data = body;
  }
  try {
    const response = await axios(config);
    if (response.data && response.data.success === true) {
      return response.data;
    } else {
      throw new Error(response.data?.error || 'Error desconocido en la API de Hologram');
    }
  } catch (error) {
    console.error(`Error en llamada a Hologram (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

// Health Check
app.get('/api/hologram/health', async (req, res) => {
  try {
    await hologramRequest('users/me');
    res.json({ ok: true, message: 'Integración con Hologram funcionando correctamente.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Estado masivo
app.post('/api/hologram/batch-state', async (req, res) => {
  const { state, deviceids, preview = false } = req.body;
  if (!state || !['pause', 'live', 'deactivate'].includes(state)) {
    return res.status(400).json({ ok: false, error: 'El campo "state" es requerido y debe ser "pause", "live" o "deactivate".' });
  }
  if (!deviceids || !Array.isArray(deviceids) || deviceids.length === 0) {
    return res.status(400).json({ ok: false, error: 'El campo "deviceids" es requerido y debe ser un array no vacío de números.' });
  }
  try {
    const payload = {
      data: {
        preview: preview,
        valid_tasks: [
          {
            endpoint: "/1/devices/state",
            params: {
              state: state,
              deviceids: deviceids,
              in_transaction: true
            }
          }
        ]
      }
    };
    const result = await hologramRequest('devices/batch/state', 'POST', payload);
    res.json({ ok: true, jobid: result.data?.jobid, message: `Solicitud de cambio de estado a '${state}' enviada.` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Consulta de uso de datos
app.get('/api/hologram/device/:deviceId/usage', async (req, res) => {
  const { deviceId } = req.params;
  let { startDate, endDate } = req.query;
  const deviceIdNum = parseInt(deviceId);
  if (isNaN(deviceIdNum)) {
    return res.status(400).json({ ok: false, error: 'El deviceId debe ser un número.' });
  }
  let startTimestamp, endTimestamp;
  const now = new Date();
  if (!startDate || !endDate) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    startTimestamp = Math.floor(start.getTime() / 1000);
    endTimestamp = Math.floor(end.getTime() / 1000);
  } else {
    startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      return res.status(400).json({ ok: false, error: 'Formato de fecha inválido. Usa YYYY-MM-DD.' });
    }
  }
  try {
    const usageData = await hologramRequest(`usage/data?deviceid=${deviceIdNum}×tart=${startTimestamp}&timeend=${endTimestamp}`);
    let totalBytes = 0;
    if (usageData.data && Array.isArray(usageData.data)) {
      for (const record of usageData.data) {
        totalBytes += record.bytes || 0;
      }
    }
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(3);
    res.json({
      ok: true,
      deviceId: deviceIdNum,
      totalMB: parseFloat(totalMB),
      startDate: new Date(startTimestamp * 1000).toISOString().split('T')[0],
      endDate: new Date(endTimestamp * 1000).toISOString().split('T')[0]
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Reset con espera
app.post('/api/hologram/device/:deviceId/reset', async (req, res) => {
  const { deviceId } = req.params;
  const deviceIdNum = parseInt(deviceId);
  if (isNaN(deviceIdNum)) {
    return res.status(400).json({ ok: false, error: 'Device ID inválido' });
  }

  async function waitForJob(jobId, timeoutMs = 40000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const jobStatus = await hologramRequest(`jobs/${jobId}`);
      const status = jobStatus.data?.status;
      if (status === 'COMPLETED') return true;
      if (status === 'FAILED') throw new Error(`Job ${jobId} falló`);
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Timeout esperando el job ${jobId}`);
  }

  try {
    const pausePayload = {
      data: {
        preview: false,
        valid_tasks: [{
          endpoint: "/1/devices/state",
          params: { state: "pause", deviceids: [deviceIdNum], in_transaction: true }
        }]
      }
    };
    const pauseResult = await hologramRequest('devices/batch/state', 'POST', pausePayload);
    const jobIdPause = pauseResult.data?.jobid;
    if (!jobIdPause) throw new Error('No se recibió jobid al pausar');
    await waitForJob(jobIdPause);
    console.log(`✅ Dispositivo ${deviceIdNum} pausado`);

    const livePayload = {
      data: {
        preview: false,
        valid_tasks: [{
          endpoint: "/1/devices/state",
          params: { state: "live", deviceids: [deviceIdNum], in_transaction: true }
        }]
      }
    };
    const liveResult = await hologramRequest('devices/batch/state', 'POST', livePayload);
    const jobIdLive = liveResult.data?.jobid;
    if (!jobIdLive) throw new Error('No se recibió jobid al reactivar');
    await waitForJob(jobIdLive);
    console.log(`✅ Dispositivo ${deviceIdNum} reactivado`);

    res.json({ ok: true, message: 'Reset completado exitosamente (pausa y reactivación)' });
  } catch (error) {
    console.error('Error en reset Hologram:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
//  ENDPOINT DE BÚSQUEDA MEJORADO (con paginación)
// =========================
app.get('/api/hologram/search/:value', async (req, res) => {
  const { value } = req.params;
  try {
    // 1. Búsqueda por deviceId numérico
    if (/^\d+$/.test(value)) {
      try {
        const deviceById = await hologramRequest(`devices/${value}`);
        if (deviceById.data) {
          return res.json({
            ok: true,
            deviceId: deviceById.data.deviceid,
            iccid: deviceById.data.sim,
            msisdn: deviceById.data.phonenumber,
            state: deviceById.data.state
          });
        }
      } catch (err) {
        // No encontrado por deviceId
      }
    }

    // 2. Búsqueda por IMEI
    try {
      const devicesByImei = await hologramRequest(`devices/?imei=${encodeURIComponent(value)}`);
      if (devicesByImei.data && devicesByImei.data.length > 0) {
        const device = devicesByImei.data[0];
        return res.json({
          ok: true,
          deviceId: device.deviceid,
          iccid: device.sim,
          msisdn: device.phonenumber,
          state: device.state
        });
      }
    } catch (err) {
      // No encontrado por IMEI
    }

    // 3. Búsqueda paginada por ICCID (sim) o MSISDN (phonenumber)
    let page = 1;
    let found = null;
    while (!found) {
      const devicesPage = await hologramRequest(`devices?page=${page}&limit=100`);
      if (!devicesPage.data || devicesPage.data.length === 0) break;
      found = devicesPage.data.find(d => d.sim === value || d.phonenumber === value);
      if (found) break;
      page++;
    }
    if (found) {
      return res.json({
        ok: true,
        deviceId: found.deviceid,
        iccid: found.sim,
        msisdn: found.phonenumber,
        state: found.state
      });
    }

    // No encontrado
    res.json({ ok: false, error: 'Dispositivo no encontrado. Verifica el ICCID o número de teléfono.' });
  } catch (error) {
    console.error('Error en búsqueda Hologram:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =========================
//  START
// =========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SERVER CON FACTOR DE CORRECCIÓN GLOBAL Y HOLOGRAM INTEGRADO");
  console.log(`🔧 Factor aplicado: ${FACTOR_GLOBAL}`);
  console.log("✅ Integración con Hologram activa con token actualizado");
  console.log("✅ Endpoint de reset con espera de jobs disponible");
  console.log("✅ Endpoint de búsqueda mejorado con paginación");
});
