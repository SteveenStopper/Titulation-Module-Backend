const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const authorize = require("../middlewares/authorize");
const vc = require("../controllers/vicerrectorComplexivoController");

// GET /vicerrector/dashboard
router.get("/dashboard", authorize('Vicerrector','Administrador'), async (req, res, next) => {
  try {
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods ? Number(per.id_academic_periods) : null;

    // Carreras activas (si existe esquema externo), fallback 0
    let carrerasActivas = 0;
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS`);
      if (Array.isArray(rows) && rows[0]) carrerasActivas = Number(rows[0].n || 0);
    } catch (_) { carrerasActivas = 0; }

    // Materias registradas (complexivo)
    const materiasRegistradas = id_ap
      ? await prisma.complexivo_materias.count({ where: { periodo_id: Number(id_ap) } }).catch(() => 0)
      : 0;

    // Cronogramas pendientes de publicar
    const pendientesPublicar = id_ap
      ? await prisma.cronogramas.count({ where: { publicado: false, periodo_id: Number(id_ap) } }).catch(() => 0)
      : 0;

    // Tutores disponibles (usuarios con rol Docente activos)
    const tutoresDisponibles = await prisma.usuarios.count({ where: { activo: true, usuario_roles: { some: { roles: { nombre: 'Docente' } } } } }).catch(() => 0);

    res.json({ carrerasActivas, materiasRegistradas, pendientesPublicar, tutoresDisponibles });
  } catch (err) { next(err); }
});

// ====== Gestión Examen Complexivo (Vicerrectorado) ======
router.get("/complexivo/materias", authorize('Vicerrector','Administrador'), vc.listMaterias);
router.post("/complexivo/materias", authorize('Vicerrector','Administrador'), vc.createMateria);
router.put("/complexivo/materias/:id/tutor", authorize('Vicerrector','Administrador'), vc.updateTutor);
router.post("/complexivo/materias/publicar", authorize('Vicerrector','Administrador'), vc.publish);
router.get("/docentes", authorize('Vicerrector','Administrador'), vc.listDocentes);
router.get("/carreras", authorize('Vicerrector','Administrador'), vc.listCarreras);
router.get("/materias-catalogo", authorize('Vicerrector','Administrador'), vc.listMateriasCatalogo);
router.get("/semestres-catalogo", authorize('Vicerrector','Administrador'), vc.listSemestresCatalogo);
router.get("/asignaturas-catalogo", authorize('Vicerrector','Administrador'), vc.listAsignaturasCatalogo);

// ====== Reportes (Vicerrectorado) ======
router.get('/reportes/resumen', authorize('Vicerrector','Administrador'), vc.reportResumen);
router.get('/reportes/distribucion-carreras', authorize('Vicerrector','Administrador'), vc.reportDistribucionCarreras);
router.get('/reportes/top-tutores', authorize('Vicerrector','Administrador'), vc.reportTopTutores);

// Nuevos reportes (formatos PDF)
router.get('/reportes/complexivo-materias', authorize('Vicerrector','Administrador'), vc.reportMateriasAsignadas);
router.get('/reportes/complexivo-docentes', authorize('Vicerrector','Administrador'), vc.reportDocentesAsignados);

module.exports = router;
