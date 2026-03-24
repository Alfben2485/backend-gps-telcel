// 📡 LISTAR SIMS (CON PAGINACIÓN AUTOMÁTICA)
app.get("/api/devices", async (req, res) => {
  try {
    let allDevices = [];
    let pageNumber = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.post(
        `${BASE_URL}/gcapi/device/list`,
        { pageNumber, pageSize },
        {
          httpsAgent: agent,
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      const items = response.data.data || [];
      allDevices = allDevices.concat(items.map(item => ({
        iccid: item.iccid,
        msisdn: item.msisdn,
        estado: item.state,
        plan: item.servicePlan?.servicePlanName || "N/A"
      })));

      if (items.length < pageSize) {
        hasMore = false;
      } else {
        pageNumber++;
      }
    }

    console.log(`✅ Total SIMs obtenidas: ${allDevices.length}`);
    res.json(allDevices);
  } catch (error) {
    console.error("ERROR DEVICES:", error.response?.data || error.message);
    res.status(500).json({ ok: false, error: error.response?.data || error.message });
  }
});
