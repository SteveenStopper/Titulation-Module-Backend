const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/tribunalController");
const authorize = require("../middlewares/authorize");

router.get("/assignments", authorize('Coordinador','Administrador','Docente'), ctrl.listAssignments);
router.post("/assignments", authorize('Coordinador','Administrador'), ctrl.createAssignment);
router.put("/assignments/:id", authorize('Coordinador','Administrador'), ctrl.updateAssignment);

router.post("/defenses/schedule", authorize('Coordinador','Administrador'), ctrl.scheduleDefense);
router.get("/defenses", authorize('Coordinador','Administrador','Docente','Estudiante'), ctrl.listDefenses);
router.post("/defenses/grade", authorize('Docente','Coordinador','Administrador'), ctrl.submitDefenseGrade);

module.exports = router;
