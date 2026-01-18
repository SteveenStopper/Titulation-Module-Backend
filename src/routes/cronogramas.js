const express = require("express");
const router = express.Router();
const { getUltimoUIC, getUICByPeriod, publicarUIC, getComplexivoByPeriod, publicarComplexivo, createDraft } = require("../controllers/cronogramasController");
const authorize = require("../middlewares/authorize");

// UIC
router.get("/uic/ultimo", getUltimoUIC);
router.get("/uic", getUICByPeriod);
router.post("/uic/publicar", authorize('Coordinador', 'Administrador'), publicarUIC);

// Complexivo
router.get("/complexivo", getComplexivoByPeriod);
router.post("/complexivo/publicar", authorize('Coordinador', 'Administrador'), publicarComplexivo);

// Crear/obtener borrador desde último publicado
router.get("/draft", authorize('Coordinador', 'Administrador'), createDraft);

module.exports = router;
