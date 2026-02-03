const express = require("express");
const router = express.Router();
const { requireModality } = require("../middlewares/requireModality");
const ctrl = require("../controllers/complexivoController");
const authorize = require("../middlewares/authorize");

router.use(requireModality("EXAMEN_COMPLEXIVO"));

router.get("/attendance/my", ctrl.myAttendance);
router.post("/attendance", ctrl.addAttendance);
router.get("/courses", ctrl.listCourses);
router.get("/courses/:courseId/teachers", ctrl.listCourseTeachers);
router.get("/veedores", ctrl.listVeedores);
router.get("/docentes", authorize('Coordinador','Administrador'), ctrl.listDocentesInstituto);
router.post("/veedores/assign", authorize('Coordinador','Administrador'), ctrl.assignVeedor);
router.put("/veedores/set", authorize('Coordinador','Administrador'), ctrl.setVeedores);

module.exports = router;
