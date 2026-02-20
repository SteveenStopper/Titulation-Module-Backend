const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/enrollmentsController");
const authorize = require("../middlewares/authorize");

// POST /enrollments/select { modality, academicPeriodId? }
// requiere usuario autenticado para leer req.user.sub
router.post("/select", authorize('Estudiante','Administrador','Coordinador'), ctrl.select);

// GET /enrollments/current?academicPeriodId=
// requiere usuario autenticado para leer req.user.sub
router.get("/current", authorize('Estudiante','Administrador','Coordinador'), ctrl.current);

// GET /enrollments/career
// devuelve carrera del estudiante autenticado (id y nombre)
router.get("/career", authorize('Estudiante','Administrador','Coordinador'), ctrl.career);

// GET /enrollments?status=&academicPeriodId=&modality=
router.get("/", authorize('Secretaria', 'Coordinador', 'Administrador'), ctrl.list);

// PUT /enrollments/:id/approve
router.put("/:id/approve", authorize('Secretaria', 'Coordinador', 'Administrador'), ctrl.approve);

// PUT /enrollments/:id/reject
router.put("/:id/reject", authorize('Secretaria', 'Coordinador', 'Administrador'), ctrl.reject);

module.exports = router;
