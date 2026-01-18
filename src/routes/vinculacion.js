const express = require("express");
const router = express.Router();
const authorize = require("../middlewares/authorize");
const ctrl = require("../controllers/vincController");

// Vinculación - requiere Administrador o Vinculacion_Practicas
router.get("/eligible", authorize('Administrador','Vinculacion_Practicas'), ctrl.listEligible);
router.post("/save-for", authorize('Administrador','Vinculacion_Practicas'), ctrl.saveFor);
router.post("/certificate", authorize('Administrador','Vinculacion_Practicas'), ctrl.certificate);

// Dashboard y actividad reciente (Vinculación + Prácticas)
router.get("/dashboard", authorize('Administrador','Vinculacion_Practicas'), ctrl.dashboard);
router.get("/recientes", authorize('Administrador','Vinculacion_Practicas'), ctrl.recientes);

module.exports = router;
