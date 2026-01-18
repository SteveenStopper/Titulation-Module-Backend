const express = require("express");
const router = express.Router();
const { requireModality } = require("../middlewares/requireModality");
const prisma = require("../../prisma/client");
const authorize = require("../middlewares/authorize");

router.use(requireModality("EXAMEN_COMPLEXIVO"));

// GET /complexivo/dashboard
router.get("/dashboard", async (req, res, next) => {
  try {
    const id_user = req.user?.sub;
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    const per = ap?.setting_value ? (typeof ap.setting_value === "string" ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    if (!per?.id_academic_periods) return res.json({ courses: [], teachers: [], veedores: [] });

    // carrera del estudiante no está normalizada en users; si la tienes externamente, aquí sería el lugar para mapearla.
    // Para demo, devolvemos veedores de todas las carreras.
    const veedores = await prisma.veedor_assignments.findMany({
      where: { id_academic_periods: per.id_academic_periods },
      select: { id: true, id_career: true, users: { select: { id_user: true, firstname: true, lastname: true, email: true } } },
    });

    const teachers = await prisma.complexivo_course_teachers.findMany({
      where: { id_academic_periods: per.id_academic_periods },
      select: { id: true, id_course: true, users: { select: { id_user: true, firstname: true, lastname: true } } },
    });

    const courses = await prisma.complexivo_courses.findMany({
      where: { is_active: true },
      select: { id_course: true, code: true, name: true },
    });

    res.json({ courses, teachers, veedores });
  } catch (err) { next(err); }
});

// GET /complexivo/estudiante/materias
// Lista las materias (Complexivo) publicadas para la carrera del estudiante en el período activo
router.get("/estudiante/materias", authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = req.user?.sub;
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    const per = ap?.setting_value ? (typeof ap.setting_value === "string" ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    // Obtener carrera del estudiante según modalidad en el período activo
    const mod = await prisma.modalidades_elegidas.findFirst({
      where: { periodo_id: Number(id_ap), estudiante_id: Number(me) },
      select: { carrera_id: true }
    });
    const careerId = mod?.carrera_id ? Number(mod.carrera_id) : null;
    if (!Number.isFinite(Number(careerId))) return res.json([]);

    // Materias publicadas: consideramos publicadas si tienen docente asignado (>0)
    const rows = await prisma.complexivo_materias.findMany({
      where: { periodo_id: Number(id_ap), carrera_id: Number(careerId), docente_usuario_id: { gt: 0 } },
      select: { complexivo_materia_id: true, codigo: true, nombre: true, docente_usuario_id: true }
    });
    if (rows.length === 0) return res.json([]);
    const tutorIds = Array.from(new Set(rows.map(r => r.docente_usuario_id))).filter(x => Number.isFinite(Number(x)));
    const tutores = tutorIds.length ? await prisma.usuarios.findMany({ where: { usuario_id: { in: tutorIds } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const mapTutor = new Map(tutores.map(t => [t.usuario_id, `${t.nombre} ${t.apellido}`.trim()]));

    const data = rows.map(r => ({
      id: String(r.complexivo_materia_id),
      codigo: r.codigo,
      nombre: r.nombre,
      docente: mapTutor.get(r.docente_usuario_id) || null,
    })).sort((a,b)=> String(a.nombre).localeCompare(String(b.nombre)));
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
