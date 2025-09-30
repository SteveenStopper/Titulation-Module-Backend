const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");

router.get("/", async (req, res, next) => {
  try {
    // Verificar conexión a DB con una consulta simple
    await prisma.$queryRaw`SELECT 1 as ok`;
    res.json({ ok: true, time: new Date().toISOString(), db: "up" });
  } catch (err) {
    // No usar errorHandler para devolver 503 explícito aquí
    if (req && req.log) req.log.error({ err }, "healthcheck failed");
    res.status(503).json({ ok: false, time: new Date().toISOString(), db: "down" });
  }
});

module.exports = router;
