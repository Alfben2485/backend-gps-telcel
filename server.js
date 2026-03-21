require("dotenv").config()

const express = require("express")
const axios = require("axios")
const cors = require("cors")
const https = require("https")

const app = express()

app.use(express.json())
app.use(cors())

const API_BASE = "https://cc.amx.claroconnect.com:8443"
const TOKEN = process.env.API_TOKEN

const api = axios.create({
  baseURL: API_BASE,
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  }
})

/* ROOT */
app.get("/", (req,res)=>{
  res.send("Backend GPS Telcel activo 🚀")
})

/* ✅ TEST FUNCIONAL REAL */
app.get("/api/test", async (req,res)=>{
  try{
    const r = await api.post("/gcapi/sims/account", {})

    res.json({
      ok:true,
      data:r.data
    })
  }catch(e){
    res.status(500).json({
      ok:false,
      error:e.response?.data || e.message
    })
  }
})

/* LISTAR SIMS */
app.get("/api/sims", async (req,res)=>{
  try{
    const r = await api.post("/gcapi/sims/account", {})
    res.json(r.data)
  }catch(e){
    res.status(500).json(e.response?.data || e.message)
  }
})

/* CONSULTAR ESTADO DE SIM */
app.get("/api/sim/:iccid", async (req,res)=>{
  try{
    const iccid = req.params.iccid

    const r = await api.get("/gcapi/getSIMState", {
      params: { iccid }
    })

    res.json(r.data)
  }catch(e){
    res.status(500).json(e.response?.data || e.message)
  }
})

/* CONSUMO */
app.get("/api/sim/:iccid/usage", async (req,res)=>{
  try{
    const iccid = req.params.iccid

    const r = await api.post("/gcapi/sim/Data/Usage", {
      iccid
    })

    res.json(r.data)
  }catch(e){
    res.status(500).json(e.response?.data || e.message)
  }
})

/* CAMBIAR ESTADO */
app.put("/api/sim/state", async (req,res)=>{
  try{
    const r = await api.put("/gcapi/device/changeState", req.body)
    res.json(r.data)
  }catch(e){
    res.status(500).json(e.response?.data || e.message)
  }
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("Servidor corriendo en puerto " + PORT)
})
