require("dotenv").config()

const express = require("express")
const axios = require("axios")
const cors = require("cors")

const app = express()

app.use(express.json())
app.use(cors())

const API_BASE = "https://cc.amx.claroconnect.com:8443"
const TOKEN = process.env.API_TOKEN

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json"
  }
})

app.get("/", (req,res)=>{
  res.send("Backend GPS Telcel activo 🚀")
})

app.get("/api/test", async (req,res)=>{
  try{
    const r = await api.get("/api/account")
    res.json({ok:true,data:r.data})
  }catch(e){
    res.status(500).json({ok:false,error:e.message})
  }
})

app.get("/api/sim/:code", async (req,res)=>{
  try{
    const code = req.params.code
    const r = await api.get(`/api/sims/${code}`)
    res.json(r.data)
  }catch(e){
    res.status(500).json({error:"SIM no encontrada"})
  }
})

app.post("/api/sims/bulk", async (req,res)=>{
  const {codes} = req.body

  let results = []

  for(const code of codes){
    try{
      const r = await api.get(`/api/sims/${code}`)
      results.push(r.data)
    }catch{
      results.push({code,error:"No encontrado"})
    }
  }

  res.json(results)
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("Servidor corriendo en puerto " + PORT)
})
