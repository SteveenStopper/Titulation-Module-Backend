const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/clearancesController");

// Secretaría - calificaciones (notas) clearance
router.get("/grades", ctrl.listGrades);
router.put("/grades", ctrl.setGrade);

// Tesorería - no adeudar
router.get("/fees", ctrl.listFees);
router.put("/fees", ctrl.setFee);

module.exports = router;
