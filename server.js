require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🚗 Ruta para jugadores
app.get("/players", async (req, res) => {
  try {
    const response = await axios.get(`${process.env.FIVEM_IP}/players`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "No se pudo obtener la respuesta de la API" });
  }
});

// 🔴 Ruta antigua de Twitch (puedes borrarla si ya usas la nueva basada en BD)
app.get("/api/streams", async (req, res) => {
  try {
    const client_id = process.env.TWITCH_CLIENT_ID;
    const client_secret = process.env.TWITCH_CLIENT_SECRET;

    const tokenRes = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`
    );
    const access_token = tokenRes.data.access_token;

    const streamers = ["habon1234", "Vryzeeee1", "vaskitoo_", "miiguell_munozz", "Zipizpe15", "ErnestoGTAV", "joselaki", "darksidedux", "reloadstyle", "yosoyover"];

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

// 🟢 Ruta para vídeos de YouTube combinados y cacheados
let cacheVideos = {
  lastUpdated: 0,
  videos: [],
};

app.get("/api/youtube-videos", async (req, res) => {
  const ahora = Date.now();
  const tresHoras = 1000 * 60 * 60 * 3;
  if (ahora - cacheVideos.lastUpdated < tresHoras && cacheVideos.videos.length > 0) {
    return res.json(cacheVideos.videos);
  }

  const API_KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_IDS = [
    "UCD2bEZM0Z4HmKpBwPh_lyWg",
    "UCL3NvneOnKeGgKQcekBe31Q",
  ];
  const PALABRAS_CLAVE = ["VilanovaCity"];
  const MAX_RESULTADOS = 15;

  const getDurationInSeconds = (iso) => {
    const match = iso.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    const min = parseInt(match?.[1] || 0);
    const sec = parseInt(match?.[2] || 0);
    return min * 60 + sec;
  };

  try {
    let todosVideos = [];

    for (const id of CHANNEL_IDS) {
      const res1 = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${id}&key=${API_KEY}`
      );
      const playlistId = res1.data.items[0].contentDetails.relatedPlaylists.uploads;

      const res2 = await axios.get(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${API_KEY}`
      );

      const filtrados = res2.data.items.filter((video) => {
        const titulo = video.snippet.title.toLowerCase();
        return PALABRAS_CLAVE.some((p) => titulo.includes(p));
      });

      const ids = filtrados.map(v => v.snippet.resourceId.videoId).join(",");
      const res3 = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${API_KEY}`
      );

      const sinShorts = res3.data.items.filter(v => getDurationInSeconds(v.contentDetails.duration) >= 180);
      const finales = filtrados.filter(v =>
        sinShorts.some(s => s.id === v.snippet.resourceId.videoId)
      );

      todosVideos.push(...finales);
    }

    const porCanal = {};
    todosVideos.forEach(v => {
      const canal = v.snippet.channelId;
      if (!porCanal[canal]) porCanal[canal] = [];
      porCanal[canal].push(v);
    });

    let mezclados = [];
    while (mezclados.length < MAX_RESULTADOS) {
      let añadido = false;
      for (const canal in porCanal) {
        const video = porCanal[canal].shift();
        if (video) {
          mezclados.push(video);
          añadido = true;
        }
      }
      if (!añadido) break;
    }

    cacheVideos.videos = mezclados;
    cacheVideos.lastUpdated = ahora;
    res.json(mezclados);
  } catch (e) {
    console.error("Error cargando vídeos de YouTube:", e.message);
    res.status(500).json({ error: "Error al cargar vídeos de YouTube" });
  }
});

// 🔷 Rutas para LOCALES
app.get("/locales", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM locales ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener los locales:", err.message);
    res.status(500).json({ error: "Error al obtener los locales" });
  }
});

app.put("/locales/:id", express.json(), async (req, res) => {
  const id = req.params.id;
  const { estado } = req.body;
  if (!estado) {
    return res.status(400).json({ error: "Falta el estado" });
  }

  try {
    const result = await pool.query(
      "UPDATE locales SET estado = $1 WHERE id = $2 RETURNING *",
      [estado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Local no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error al actualizar el local:", err.message);
    res.status(500).json({ error: "Error al actualizar el local" });
  }
});

// 🔷 Rutas para STREAMERS
app.get("/streamers", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM streamers ORDER BY id");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener streamers" });
  }
});

app.post("/streamers", express.json(), async (req, res) => {
  const { user_name, plataforma, url } = req.body;
  if (!user_name || !plataforma || !url) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  try {
    const { rows } = await pool.query(
      "INSERT INTO streamers (user_name, plataforma, url) VALUES ($1, $2, $3) RETURNING *",
      [user_name, plataforma, url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al añadir streamer" });
  }
});

app.put("/streamers/:user_name", express.json(), async (req, res) => {
  const { user_name } = req.params;
  const { estado } = req.body;

  try {
    const result = await pool.query(
      "UPDATE streamers SET estado = $1, ultima_actualizacion = NOW() WHERE user_name = $2 RETURNING *",
      [estado, user_name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Streamer no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar streamer" });
  }
});

// 🟢 Función para actualizar automáticamente el estado de Twitch
async function actualizarEstadoStreamersTwitch() {
  try {
    const client_id = process.env.TWITCH_CLIENT_ID;
    const client_secret = process.env.TWITCH_CLIENT_SECRET;

    const tokenRes = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`
    );
    const access_token = tokenRes.data.access_token;

    const { rows } = await pool.query("SELECT * FROM streamers WHERE plataforma = 'Twitch'");
    const user_names = rows.map(r => r.user_name);

    if (user_names.length === 0) return;

    const twitchRes = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=${user_names.join("&user_login=")}`,
      {
        headers: {
          "Client-ID": client_id,
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const enDirecto = twitchRes.data.data.map(s => s.user_name);

    for (const user of user_names) {
      const activo = enDirecto.includes(user);
      await pool.query(
        "UPDATE streamers SET estado = $1, ultima_actualizacion = NOW() WHERE user_name = $2",
        [activo, user]
      );
    }

    console.log("✔️ Estados de streamers actualizados");
  } catch (err) {
    console.error("❌ Error al actualizar estados de Twitch:", err.message);
  }
}

// Ejecutar cada 5 minutos
setInterval(actualizarEstadoStreamersTwitch, 1000 * 60 * 5);

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor proxy corriendo en el puerto ${PORT}`);
});

// Obtener todos los streamers
app.get("/streamers", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM streamers ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener streamers:", err.message);
    res.status(500).json({ error: "Error al obtener streamers" });
  }
});

// Actualizar el estado de un streamer (true o false)
app.put("/streamers/:id", express.json(), async (req, res) => {
  const id = req.params.id;
  const { estado } = req.body;

  if (typeof estado === "undefined") {
    return res.status(400).json({ error: "Falta el campo estado" });
  }

  try {
    const result = await pool.query(
      "UPDATE streamers SET estado = $1, ultima_actualizacion = NOW() WHERE id = $2 RETURNING *",
      [estado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Streamer no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error al actualizar streamer:", err.message);
    res.status(500).json({ error: "Error al actualizar streamer" });
  }
});

router.get('/admin/streamers', async (req, res) => {
  try {
    const streamers = await db('streamers').select('*'); // sin filtro
    res.json(streamers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener streamers' });
  }
});

