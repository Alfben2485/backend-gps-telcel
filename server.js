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
//  CUENTA ORIGINAL (CLARO)
// =========================
const USERNAME = "alfben";
const PASSWORD = "Soporte122@";

let TOKEN = null;
let TOKEN_TIME = 0;

const ACCOUNTS_EXTRA = {
  cuenta2: { username: "alfben2", password: "Soporte122@", token: null, tokenTime: 0 },
  cuenta3: { username: "alfben4", password: "Soporte122@", token: null, tokenTime: 0 },
};

const TOKEN_DURATION = 50 * 60 * 1000;

async function getToken() {
  const r = await axios({ httpsAgent: agent, method: "post", url: `${BASE_URL}/gcapi/auth`, data: { username: USERNAME, password: PASSWORD } });
  TOKEN = r.data?.token;
  TOKEN_TIME = Date.now();
  console.log("🔑 Token Claro actualizado");
}
async function ensureToken() { if (!TOKEN || Date.now() - TOKEN_TIME > TOKEN_DURATION) await getToken(); }
async function ensureTokenExtra(key) {
  const acc = ACCOUNTS_EXTRA[key];
  if (!acc.token || Date.now() - acc.tokenTime > TOKEN_DURATION) {
    const r = await axios({ httpsAgent: agent, method: "post", url: `${BASE_URL}/gcapi/auth`, data: { username: acc.username, password: acc.password } });
    acc.token = r.data?.token;
    acc.tokenTime = Date.now();
    console.log(`🔑 Token extra (${key}) actualizado`);
  }
}

async function claroRequest(config) { await ensureToken(); return axios({ httpsAgent: agent, timeout: 15000, ...config, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }); }
async function claroRequestExtra(key, config) { await ensureTokenExtra(key); return axios({ httpsAgent: agent, timeout: 15000, ...config, headers: { Authorization: `Bearer ${ACCOUNTS_EXTRA[key].token}`, "Content-Type": "application/json" } }); }

function extractIMSI(item) { return item.imsi || item.subscription?.imsi || item.sim?.imsi || item.deviceInfo?.imsi || null; }

const usageCache = new Map();
const CACHE_TIME = 2 * 60 * 1000;
const FACTOR_GLOBAL = 1.902;
const FACTORES_POR_ICCID = {};

async function fetchUsage(request, imsi, iccid) {
  if (!imsi) return { consumoMB: 0 };
  const cached = usageCache.get(imsi);
  if (cached && Date.now() - cached.time < CACHE_TIME) { console.log(`⚡ Caché para IMSI ${imsi}`); return cached.data; }
  const now = new Date();
  let start, end;
  if (now.getDate() >= 27) { start = new Date(now.getFullYear(), now.getMonth(), 27); end = new Date(now.getFullYear(), now.getMonth() + 1, 25); }
  else { start = new Date(now.getFullYear(), now.getMonth() - 1, 27); end = new Date(now.getFullYear(), now.getMonth(), 25); }
  const format = (d) => d.toISOString().split("T")[0];
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) dates.push(format(new Date(d)));
  let totalMB = 0;
  const BATCH_SIZE = 6;
  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.flatMap(date => [
      request({ method: "post", url: `${BASE_URL}/gcapi/simUplink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null),
      request({ method: "post", url: `${BASE_URL}/gcapi/simDownlink/usage`, data: { imsi, startDate: date, endDate: date } }).catch(() => null)
    ]));
    for (const res of results) {
      if (res && res.data && res.data.object) for (const day of res.data.object) totalMB += Number(day["totalBytes(MB)"] ?? 0);
    }
  }
  try {
    const sessionRes = await request({ method: "post", url: `${BASE_URL}/gcapi/device/sessionHistory`, data: { imsi, startDate: format(start), endDate: format(end) } });
    const sessions = sessionRes.data?.data || [];
    for (const s of sessions) totalMB += Number(s.totalBytes || 0) / (1024 * 1024);
  } catch (err) { console.log("⚠️ sessionHistory falló"); }
  const factor = FACTORES_POR_ICCID[iccid] || FACTOR_GLOBAL;
  const rounded = Number((totalMB * factor).toFixed(3));
  const result = { consumoMB: rounded };
  usageCache.set(imsi, { time: Date.now(), data: result });
  return result;
}

async function fetchSim(request, value) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/device/list`, data: { start: 0, length: 10, search: { value } } });
  const items = r.data?.data || [];
  return items.find(i => String(i.iccid).trim() === String(value).trim() || String(i.msisdn).trim() === String(value).trim());
}
async function getSimExtra(request, sim) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/get/sims`, data: { msisdn: sim.msisdn } });
  const device = (r.data?.devices || []).find(d => String(d.iccid) === String(sim.iccid));
  return { imsi: device?.imsi, plan: device?.devicePlans?.planName || "N/A" };
}
async function getTotalSims(request) {
  const r = await request({ method: "post", url: `${BASE_URL}/gcapi/device/list`, data: { start: 0, length: 1 } });
  return r.data?.recordsFiltered || 0;
}

function buildEndpoint(path, requestFn) {
  app.get(path, async (req, res) => {
    const timeout = setTimeout(() => res.json({ ok: false, error: "Timeout" }), 25000);
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) { clearTimeout(timeout); return res.json({ ok: false, error: "SIM no encontrada" }); }
      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);
      const [consumo, totalSims] = await Promise.all([fetchUsage(requestFn, imsi, sim.iccid), getTotalSims(requestFn)]);
      clearTimeout(timeout);
      res.json({ ok: true, totalSims, iccid: sim.iccid, msisdn: sim.msisdn, estado: sim.state, plan: extra.plan, consumoMB: consumo.consumoMB });
    } catch (error) { clearTimeout(timeout); res.json({ ok: false, error: error.message }); }
  });
}

function buildReset(path, requestFn) {
  app.post(path, async (req, res) => {
    try {
      const sim = await fetchSim(requestFn, req.params.value);
      if (!sim) return res.json({ ok: false, error: "SIM no encontrada" });
      const extra = await getSimExtra(requestFn, sim);
      const imsi = extra.imsi || extractIMSI(sim);
      const r = await requestFn({ method: "post", url: `${BASE_URL}/gcapi/sim/reset`, data: { imsi } });
      res.json({ ok: true, data: r.data });
    } catch (error) { res.json({ ok: false, error: error.message }); }
  });
}

buildEndpoint("/api/device/full/:value", claroRequest);
buildEndpoint("/api2/device/full/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildEndpoint("/api3/device/full/:value", (cfg) => claroRequestExtra("cuenta3", cfg));
buildReset("/api/device/reset/:value", claroRequest);
buildReset("/api2/device/reset/:value", (cfg) => claroRequestExtra("cuenta2", cfg));
buildReset("/api3/device/reset/:value", (cfg) => claroRequestExtra("cuenta3", cfg));

// =========================
//  INTEGRACIÓN CON HOLOGRAM
// =========================
const HOLOGRAM_API_TOKEN = "YXBpa2V5OjZKSVlEcVF0VXpwcGZFcmVxeENLSE1RWExJMWt2Yg==";

async function hologramRequest(endpoint, method = 'GET', body = null) {
  const config = {
    method, url: `https://dashboard.hologram.io/api/1/${endpoint}`,
    headers: { 'Authorization': `Basic ${HOLOGRAM_API_TOKEN}`, 'Content-Type': 'application/json' },
    timeout: 15000, httpsAgent: agent
  };
  if (body) config.data = body;
  const response = await axios(config);
  if (response.data && (response.data.success === true || response.data.data !== undefined)) return response.data;
  console.error(`Respuesta de Hologram (${endpoint}):`, JSON.stringify(response.data, null, 2));
  throw new Error(response.data?.error || response.data?.message || 'Error desconocido en la API de Hologram');
}

// Health Check
app.get('/api/hologram/health', async (req, res) => {
  try { await hologramRequest('users/me'); res.json({ ok: true }); } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Endpoint temporal: listar todos los dispositivos (para depuración)
app.get('/api/hologram/list-all-devices', async (req, res) => {
  try {
    let page = 1;
    let allDevices = [];
    const limit = 100;
    while (true) {
      const response = await hologramRequest(`devices?page=${page}&limit=${limit}`);
      if (!response.data || response.data.length === 0) break;
      allDevices.push(...response.data);
      if (response.data.length < limit) break;
      page++;
    }
    const devicesMap = allDevices.map(d => ({
      deviceId: d.id,
      iccid: d.sim || d.iccid || d.active_iccid || d.enabled_iccid || 'NO_ICCID',
      name: d.name,
      state: d.state
    }));
    res.json({ ok: true, total: devicesMap.length, devices: devicesMap });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Estado masivo
app.post('/api/hologram/batch-state', async (req, res) => {
  const { state, deviceids, preview = false } = req.body;
  if (!state || !['pause','live','deactivate'].includes(state)) return res.status(400).json({ ok: false, error: 'Estado inválido' });
  if (!deviceids || !Array.isArray(deviceids) || deviceids.length===0) return res.status(400).json({ ok: false, error: 'deviceids requerido' });
  try {
    const payload = { data: { preview, valid_tasks: [{ endpoint: "/1/devices/state", params: { state, deviceids, in_transaction: true } }] } };
    const result = await hologramRequest('devices/batch/state', 'POST', payload);
    res.json({ ok: true, jobid: result.data?.jobid, message: `Solicitud de cambio de estado a '${state}' enviada.` });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Consulta de uso
app.get('/api/hologram/device/:deviceId/usage', async (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  if (isNaN(deviceId)) return res.status(400).json({ ok: false, error: 'deviceId inválido' });
  let { startDate, endDate } = req.query;
  const now = new Date();
  if (!startDate || !endDate) {
    let end = new Date(now); end.setHours(23,59,59,999);
    let start = new Date(now); start.setDate(now.getDate()-30); start.setHours(0,0,0,0);
    startDate = Math.floor(start.getTime()/1000); endDate = Math.floor(end.getTime()/1000);
  } else {
    startDate = Math.floor(new Date(startDate).getTime()/1000);
    endDate = Math.floor(new Date(endDate).getTime()/1000);
    if (isNaN(startDate) || isNaN(endDate)) return res.status(400).json({ ok: false, error: 'Formato de fecha inválido' });
  }
  try {
    const usage = await hologramRequest(`usage/data?deviceid=${deviceId}×tart=${startDate}&timeend=${endDate}`);
    let totalBytes = 0;
    if (usage.data) for (let r of usage.data) totalBytes += r.bytes || 0;
    res.json({ ok: true, deviceId, totalMB: parseFloat((totalBytes/(1024*1024)).toFixed(3)) });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Reset con espera
app.post('/api/hologram/device/:deviceId/reset', async (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  if (isNaN(deviceId)) return res.status(400).json({ ok: false, error: 'deviceId inválido' });
  const waitForJob = async (jobId, timeout=40000) => {
    const start = Date.now();
    while (Date.now()-start < timeout) {
      const status = await hologramRequest(`jobs/${jobId}`);
      if (status.data?.status === 'COMPLETED') return true;
      if (status.data?.status === 'FAILED') throw new Error(`Job ${jobId} falló`);
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('Timeout esperando job');
  };
  try {
    const pause = await hologramRequest('devices/batch/state', 'POST', { data: { preview: false, valid_tasks: [{ endpoint: "/1/devices/state", params: { state: "pause", deviceids: [deviceId], in_transaction: true } }] } });
    const jobPause = pause.data?.jobid; if (!jobPause) throw new Error('No jobid en pausa');
    await waitForJob(jobPause);
    const live = await hologramRequest('devices/batch/state', 'POST', { data: { preview: false, valid_tasks: [{ endpoint: "/1/devices/state", params: { state: "live", deviceids: [deviceId], in_transaction: true } }] } });
    const jobLive = live.data?.jobid; if (!jobLive) throw new Error('No jobid en reactivación');
    await waitForJob(jobLive);
    res.json({ ok: true, message: 'Reset completado' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Búsqueda por ICCID con múltiples campos y paginación
app.get('/api/hologram/search/:iccid', async (req, res) => {
  const { iccid } = req.params;
  console.log(`🔍 Buscando dispositivo por ICCID: ${iccid}`);
  if (!/^\d{18,20}$/.test(iccid)) {
    return res.status(400).json({ ok: false, error: 'ICCID inválido. Debe tener 18-20 dígitos.' });
  }

  const fieldNames = ['sim', 'iccid', 'active_iccid', 'enabled_iccid'];
  let foundDevice = null;
  for (const field of fieldNames) {
    try {
      console.log(`Intentando búsqueda con ${field}=${iccid}`);
      const response = await hologramRequest(`devices?${field}=${encodeURIComponent(iccid)}`);
      if (response && response.data && response.data.length > 0) {
        foundDevice = response.data[0];
        console.log(`✅ Encontrado usando campo '${field}'`);
        break;
      }
    } catch (err) {
      console.log(`Búsqueda con ${field} falló: ${err.message}`);
    }
  }

  if (!foundDevice) {
    console.log("⚠️ Búsqueda directa falló. Iniciando paginación manual...");
    let page = 1;
    const limit = 100;
    while (!foundDevice) {
      const pageData = await hologramRequest(`devices?page=${page}&limit=${limit}`);
      if (!pageData.data || pageData.data.length === 0) break;
      foundDevice = pageData.data.find(device => {
        return device.sim === iccid || device.iccid === iccid || device.active_iccid === iccid || device.enabled_iccid === iccid;
      });
      if (foundDevice) break;
      page++;
      if (page > 50) break;
    }
  }

  if (foundDevice) {
    console.log(`✅ Dispositivo encontrado: ID=${foundDevice.id}`);
    res.json({
      ok: true,
      deviceId: foundDevice.id,
      name: foundDevice.name,
      iccid: iccid,
      state: foundDevice.active_link_state || foundDevice.state,
      phonenumber: foundDevice.phonenumber,
      imei: foundDevice.imei,
      plan: foundDevice.plan_name
    });
  } else {
    console.log(`❌ No se encontró ningún dispositivo con ICCID ${iccid}`);
    res.status(404).json({ ok: false, error: 'No se encontró ningún dispositivo con ese ICCID.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🔧 Factor Claro: ${FACTOR_GLOBAL}`);
  console.log(`✅ Endpoints disponibles:`);
  console.log(`   Claro: /api/device/full/:value, /api/device/reset/:value (y /api2, /api3)`);
  console.log(`   Hologram: /api/hologram/health, /api/hologram/batch-state`);
  console.log(`   Hologram: /api/hologram/device/:deviceId/usage, /api/hologram/device/:deviceId/reset`);
  console.log(`   Hologram: /api/hologram/search/:iccid, /api/hologram/list-all-devices (temporal)`);
});
