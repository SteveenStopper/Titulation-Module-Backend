const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const viewsDao = require("../daos/viewsDao");

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

// GET /health/views
router.get("/views", async (req, res) => {
  try {
    const names = [
      'vw_estudiantes',
      'vw_carreras',
      'vw_docentes',
      'vw_estado_financiero',
      'vw_notas_estudiantes',
      'vw_semestres_aprobados',
      'vw_tesoreria_resumen',
      'vw_secretaria_promedios'
    ];
    const checks = {};
    for (const v of names) {
      // eslint-disable-next-line no-await-in-loop
      checks[v] = await viewsDao.viewExists(v);
    }
    res.json({ ok: true, schema: process.env.INSTITUTO_SCHEMA || null, views: checks });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'health views failed' });
  }
});
