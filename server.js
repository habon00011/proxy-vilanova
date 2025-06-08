const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 🚗 Ruta para jugadores
app.get("/players", async (req, res) => {
  try {
    const response = await axios.get("http://185.230.55.63:4000/players");
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "No se pudo obtener la respuesta de la API" });
  }
});

// 🔴 Ruta para streamers
app.get("/api/streams", async (req, res) => {
  try {
    const client_id = "gau216jyhd0ynqaxy4laxjz0wg54q7";
    const client_secret = "j3ot53t5xto6hqadus17ho1xeiax0x";

    // Obtener token
    const tokenRes = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`
    );

    const access_token = tokenRes.data.access_token;

    const streamers = ["maryymme"];

    const streamsRes = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=${streamers.join("&user_login=")}`,
      {
        headers: {
          "Client-ID": client_id,
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const data = streamsRes.data.data.map((stream) => ({
      user_name: stream.user_name,
      title: stream.title,
      thumbnail: stream.thumbnail_url.replace("{width}", "480").replace("{height}", "270"),
      url: `https://twitch.tv/${stream.user_login}`,
    }));

    res.json(data);
  } catch (err) {
    console.error("Error al obtener streams:", err.response?.data || err.message);
    res.status(500).json({ error: "Error al obtener streams" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor proxy corriendo en el puerto ${PORT}`);
});
