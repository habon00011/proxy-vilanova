require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(cookieParser());

const allowed = [process.env.ALLOWED_ORIGIN, "http://localhost:5173"].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return allowed.includes(origin) ? cb(null, true) : cb(new Error("CORS blocked"));
  },
  credentials: true,
}));

app.use(express.json({ limit: "5mb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});


// para logica de staff
const pinLimiter = rateLimit({
  windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false,
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
//Ruta de directos

// 🔷 Rutas para STREAMERS (LIMPIO y unificado)

// Listar para la web pública si quieres
app.get("/streamers", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, user_name, plataforma, url, discord_id, estado, ultima_actualizacion FROM streamers ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener streamers:", err.message);
    res.status(500).json({ error: "Error al obtener streamers" });
  }
});

// Listar para el panel admin (misma info; si quieres añadir más campos, hazlo aquí)
app.get("/admin/streamers", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, user_name, plataforma, url, discord_id, estado, ultima_actualizacion FROM streamers ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener streamers:", err.message);
    res.status(500).json({ error: "Error al obtener streamers" });
  }
});

// Crear streamer (ahora acepta discord_id)
app.post("/streamers", async (req, res) => {
  try {
    const { user_name, plataforma, url, discord_id, estado = false } = req.body || {};

    if (!user_name || !plataforma || !url || !discord_id) {
      return res.status(400).json({ error: "Faltan campos obligatorios (user_name, plataforma, url, discord_id)" });
    }

    const plataformasPermitidas = ["Twitch", "Kick", "TikTok"];
    if (!plataformasPermitidas.includes(plataforma)) {
      return res.status(400).json({ error: "Plataforma no válida" });
    }

    if (!/^[0-9]{17,19}$/.test(String(discord_id))) {
      return res.status(400).json({ error: "Discord ID inválido (17–19 dígitos numéricos)" });
    }

    const q = `
      INSERT INTO streamers (user_name, plataforma, url, estado, discord_id, ultima_actualizacion)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, user_name, plataforma, url, discord_id, estado, ultima_actualizacion
    `;
    const params = [user_name.trim(), plataforma, url.trim(), !!estado, String(discord_id)];
    const { rows } = await pool.query(q, params);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("POST /streamers error:", err.message);
    res.status(500).json({ error: "Error al añadir streamer" });
  }
});


// Actualizar streamer por ID (puedes mandar cualquiera de estos: estado, url, discord_id)
app.put("/streamers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let { estado, url, discord_id } = req.body || {};

    // Validación discord_id si viene
    if (discord_id !== undefined) {
      discord_id = String(discord_id).trim();
      if (discord_id !== "" && !/^[0-9]{17,19}$/.test(discord_id)) {
        return res.status(400).json({ error: "Discord ID inválido (17–19 dígitos numéricos)" });
      }
    }

    // Construir SET dinámico
    const sets = [];
    const vals = [];
    let i = 1;

    if (estado !== undefined) {
      sets.push(`estado = $${i++}`);
      vals.push(!!estado);
      // si tocas estado, actualizamos fecha también
      sets.push(`ultima_actualizacion = NOW()`);
    }
    if (url !== undefined) {
      sets.push(`url = $${i++}`);
      vals.push(url || null);
    }
    if (discord_id !== undefined) {
      sets.push(`discord_id = $${i++}`);
      vals.push(discord_id || null);
    }

    if (sets.length === 0) return res.status(400).json({ error: "Nada que actualizar" });

    const q = `UPDATE streamers SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, user_name, plataforma, url, discord_id, estado, ultima_actualizacion`;
    vals.push(id);

    const { rows } = await pool.query(q, vals);
    if (!rows[0]) return res.status(404).json({ error: "Streamer no encontrado" });

    res.json(rows[0]);
  } catch (err) {
    console.error("Error al actualizar streamer:", err.message);
    res.status(500).json({ error: "Error al actualizar streamer" });
  }
});

// Ruta para eliminar streamer
app.delete("/streamers/:id", async (req, res) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const result = await pool.query("DELETE FROM streamers WHERE id = $1", [idNum]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Streamer no encontrado" });
    }

    return res.sendStatus(204); // OK sin cuerpo
  } catch (err) {
    console.error("Error al eliminar streamer:", err);
    return res.status(500).json({ error: "Error al eliminar streamer" });
  }
});

// 🔎 Devuelve SOLO los streamers en directo cuyo título contiene "Vilanova City" (con o sin "RP")
app.get("/streamers/filtrados", async (req, res) => {
  try {
    const client_id = process.env.TWITCH_CLIENT_ID;
    const client_secret = process.env.TWITCH_CLIENT_SECRET;

    // 1) Token de Twitch
    const tokenRes = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`
    );
    const access_token = tokenRes.data.access_token;

    // 2) Streamers en BD
    const { rows: streamers } = await pool.query(
      "SELECT id, user_name, plataforma, url, estado FROM streamers ORDER BY id"
    );
    if (streamers.length === 0) return res.json([]);

    // 3) Solo Twitch para consultar Helix
    const twitchUsers = streamers
      .filter(s => s.plataforma === "Twitch")
      .map(s => s.user_name);

    if (twitchUsers.length === 0) {
      // si no hay de Twitch, devolvemos los que ya estén marcados en directo
      return res.json(streamers.filter(s => s.estado === true));
    }

    // 4) Streams activos ahora
    const helix = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=${twitchUsers.join("&user_login=")}`,
      { headers: { "Client-ID": client_id, Authorization: `Bearer ${access_token}` } }
    );

    const vivos = helix.data?.data || [];

    // 5) Filtro de título: VilanovaCity | Vilanova City | VilanovaCityRP | Vilanova City RP (case-insensitive)
    const VILANOVA_RE = /(vilanova\s*city(\s*rp)?)/i;

    // Set con los logins válidos (que están en directo y cuyo título pasa el filtro)
    const loginsValidos = new Set(
      vivos
        .filter(v => VILANOVA_RE.test(v.title || ""))
        .map(v => String(v.user_login).toLowerCase())
    );

    // 6) Respuesta: de tu BD, solo los que (a) están en directo y (b) están en loginsValidos
    const respuesta = streamers.filter(
      s => s.estado === true && loginsValidos.has(String(s.user_name).toLowerCase())
    );

    res.json(respuesta);
  } catch (err) {
    console.error("Error en /streamers/filtrados:", err.message);
    res.status(500).json({ error: "Error al filtrar streamers" });
  }
});





// 🟢 Ruta para vídeos de YouTube combinados y cacheados
// 🟢 Ruta para vídeos de YouTube combinados y cacheados
let cacheVideos = { lastUpdated: 0, videos: [] };

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
    "UCIZXEOLtUGO2JyGK9RO49BQ", // 👈 el que me pasaste
  ];

  // ✅ Ponemos todo en minúsculas y ampliamos keywords
  const PALABRAS_CLAVE = ["vilanova", "vilanova city", "vilanovacity", "directo", "vuelvo"];

  // ✅ Soporta horas en ISO8601 (PT#H#M#S)
  const getDurationInSeconds = (iso) => {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const h = parseInt(m?.[1] || 0, 10);
    const min = parseInt(m?.[2] || 0, 10);
    const sec = parseInt(m?.[3] || 0, 10);
    return h * 3600 + min * 60 + sec;
  };

  try {
    let todosVideos = [];

    for (const id of CHANNEL_IDS) {
      // 1) uploads playlist del canal
      const res1 = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${id}&key=${API_KEY}`
      );
      const items1 = res1.data?.items || [];
      if (!items1.length) {
        console.warn(`Canal sin contentDetails o ID inválido: ${id}`);
        continue;
      }
      const playlistId = items1[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) continue;

      // 2) últimos vídeos del canal
      const res2 = await axios.get(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${API_KEY}`
      );
      const items2 = res2.data?.items || [];

      // ✅ Filtro por keywords (todo en lowercase)
      const filtrados = items2.filter((video) => {
        const titulo = (video?.snippet?.title || "").toLowerCase();
        return PALABRAS_CLAVE.some((p) => titulo.includes(p));
      });

      if (!filtrados.length) continue;

      // 3) detalles para duración y filtrar Shorts (< 180s)
      const ids = filtrados.map(v => v.snippet.resourceId.videoId).join(",");
      const res3 = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${API_KEY}`
      );
      const detalles = res3.data?.items || [];
      const permitidos = new Set(
        detalles
          .filter(v => getDurationInSeconds(v.contentDetails?.duration || "PT0S") >= 180)
          .map(v => v.id)
      );

      const finales = filtrados.filter(v => permitidos.has(v.snippet.resourceId.videoId));
      todosVideos.push(...finales);
    }

    // Reparto equitativo por canal
    const porCanal = {};
    for (const v of todosVideos) {
      const canal = v.snippet.channelId;
      (porCanal[canal] ||= []).push(v);
    }

    const MAX_RESULTADOS = 15;
    const mezclados = [];
    while (mezclados.length < MAX_RESULTADOS) {
      let añadido = false;
      for (const canal of Object.keys(porCanal)) {
        const video = porCanal[canal].shift();
        if (video) { mezclados.push(video); añadido = true; }
      }
      if (!añadido) break;
    }

    cacheVideos.videos = mezclados;
    cacheVideos.lastUpdated = ahora;

    // Log útil para depurar
    console.log(`YouTube OK: ${mezclados.length} vídeos tras filtro/shorts`);

    res.json(mezclados);
  } catch (e) {
    console.error("Error cargando vídeos de YouTube:", e?.response?.data || e.message);
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

app.get('/admin/streamers', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM streamers ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Error al obtener streamers:", err.message);
    res.status(500).json({ error: 'Error al obtener streamers' });
  }
});
async function logDiscord(embed) {
  const url = process.env.DISCORD_WEBHOOK_LOGS;
  if (!url) return; // si no hay URL, no falles
  try { await axios.post(url, { embeds: [embed] }); }
  catch (e) { console.error("Discord webhook:", e.message); }
}

app.get("/api/staff/entrada", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    await logDiscord({
      title: "🚪 Entrada al Panel Staff",
      color: 0x3498db,
      fields: [
        { name: "IP", value: String(ip), inline: true },
        { name: "User-Agent", value: String(req.headers["user-agent"] || ""), inline: false },
      ],
      timestamp: new Date().toISOString(),
    });
    return res.json({ ok: true, msg: "Log enviado a Discord" });
  } catch (e) {
    console.error("entrada error:", e.message);
    return res.status(200).json({ ok: true, msg: "Log no crítico" }); // nunca rompas el login
  }
});


