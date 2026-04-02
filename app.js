const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const playerRoutes = require("./routes/playerRoutes");
const aiRoutes = require("./routes/aiRoutes");
const playRoutes = require("./routes/playRoutes");
const skillRoutes = require("./routes/skillRoutes");


const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

/* =========================
   🔥 CORS CONFIG (FIXES YOUR ERROR)
========================= */
app.use(cors());

/* =========================
   BODY PARSER
========================= */
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "RPG Reincarnation API is running ⚔️",
  });
});

/* =========================
   ROUTES
========================= */
app.use("/api/auth", authRoutes);
app.use("/api/player", playerRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/play", playRoutes);
app.use("/api/skills", skillRoutes);


/* =========================
   ERROR HANDLING
========================= */
app.use(notFound);
app.use(errorHandler);

module.exports = app;