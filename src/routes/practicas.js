const express = require("express");
const router = express.Router();
const authorize = require("../middlewares/authorize");
const ctrl = require("../controllers/practicasController");

// Prácticas - requiere Administrador o Vinculacion_Practicas
router.get("/eligible", authorize('Administrador','Vinculacion_Practicas'), ctrl.listEligible);
router.post("/save-for", authorize('Administrador','Vinculacion_Practicas'), ctrl.saveFor);
router.post("/certificate", authorize('Administrador','Vinculacion_Practicas'), ctrl.certificate);

module.exports = router;
