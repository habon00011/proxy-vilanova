const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/players", async (req, res) => {
  try {
    const response = await axios.get("http://185.230.55.63:4000/players");
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "No se pudo obtener la respuesta de la API" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor proxy corriendo en el puerto ${PORT}`);
});
