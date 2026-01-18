const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/englishController");
const authorize = require("../middlewares/authorize");

// GET /english/my
router.get("/my", ctrl.getMy);
// POST /english/save
router.post("/save", ctrl.saveMy);
// PUT /english/validate/:id
router.put("/validate/:id", ctrl.validate);
// POST /english/certificate -> returns a PDF stream
router.post("/certificate", ctrl.certificate);

// Admin/Inglés: listar elegibles por Tesorería y guardar calificación para un estudiante
router.get("/eligible", authorize('Administrador','Ingles'), ctrl.listEligible);
router.post("/save-for", authorize('Administrador','Ingles'), ctrl.saveFor);

// Dashboard (KPIs) y actividad reciente
router.get("/dashboard", authorize('Administrador','Ingles'), ctrl.dashboard);
router.get("/recientes", authorize('Administrador','Ingles'), ctrl.recientes);

module.exports = router;
