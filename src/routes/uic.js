const express = require("express");
const router = express.Router();
const { requireModality } = require("../middlewares/requireModality");
const prisma = require("../../prisma/client");
const { z } = require("zod");
const authorize = require("../middlewares/authorize");

// Admin endpoint (Coordinación) para requerir informe final
router.post("/admin/final/require", authorize('Coordinador', 'Administrador'), async (req, res, next) => {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int() });

// GET /uic/admin/estudiantes-sin-lector?careerId=&academicPeriodId=
router.get('/admin/estudiantes-sin-lector', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(id_ap)) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);
    // Estudiantes UIC en el periodo (por modalidad)
    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);
    // Asignaciones del periodo
    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds } },
      select: { estudiante_id: true, carrera_id: true, tutor_usuario_id: true, lector_usuario_id: true }
    });
    // Filtrar los que no tienen lector asignado
    const sinLector = asigns.filter(a => !Number.isFinite(Number(a.lector_usuario_id)));
    const estIdsSinLector = sinLector.map(a => a.estudiante_id);
    if (estIdsSinLector.length === 0) return res.json([]);
    // Nombres estudiantes
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: estIdsSinLector } }, select: { usuario_id: true, nombre: true, apellido: true } });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    // Nombres carrera
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(sinLector.map(a => a.carrera_id).filter(x => Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }
    // Nombre de tutor asignado (si lo hay)
    const mapTutorName = new Map();
    const tutorIds = Array.from(new Set(sinLector.map(a => a.tutor_usuario_id).filter(x => Number.isFinite(Number(x)))));
    if (tutorIds.length) {
      const tus = await prisma.usuarios.findMany({ where: { usuario_id: { in: tutorIds } }, select: { usuario_id: true, nombre: true, apellido: true } });
      tus.forEach(t => mapTutorName.set(t.usuario_id, `${t.nombre} ${t.apellido}`.trim()));
    }
    // Armar respuesta
    const data = sinLector.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: nameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
      career_id: a.carrera_id ?? null,
      career_name: a.carrera_id ? (careerNameMap[a.carrera_id] || null) : null,
      tutor_name: a.tutor_usuario_id ? (mapTutorName.get(a.tutor_usuario_id) || null) : null,
    })).sort((x,y)=> String(x.fullname).localeCompare(String(y.fullname)));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/admin/estudiantes-uic-sin-tribunal?careerId=&academicPeriodId=
// Lista estudiantes UIC del período/carrera que NO tienen tribunal asignado aún. Incluye tutor asignado.
router.get('/admin/estudiantes-uic-sin-tribunal', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);

    // Estudiantes con tribunal asignado
    const ta = await prisma.tribunal_assignments.findMany({
      where: { id_academic_periods: Number(id_ap), id_user_student: { in: estIds } },
      select: { id_user_student: true }
    });
    const withTribunal = new Set((ta || []).map(x => Number(x.id_user_student)));
    const sinTribunalIds = estIds.filter(id => !withTribunal.has(Number(id)));
    if (sinTribunalIds.length === 0) return res.json([]);

    // Tutor por estudiante (si existe uic_asignaciones)
    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: sinTribunalIds } },
      select: { estudiante_id: true, tutor_usuario_id: true }
    });
    const tutorIdMap = new Map(asigns.map(a => [Number(a.estudiante_id), a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null]));

    const allUserIds = Array.from(new Set([
      ...sinTribunalIds.map(Number),
      ...Array.from(tutorIdMap.values()).filter(x => Number.isFinite(Number(x))).map(Number)
    ]));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: allUserIds } }, select: { usuario_id: true, nombre: true, apellido: true } });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const data = sinTribunalIds.map(id => ({
      id_user: Number(id),
      fullname: nameMap.get(Number(id)) || `Usuario ${id}`,
      tutor_id: tutorIdMap.get(Number(id)) ?? null,
      tutor_name: tutorIdMap.get(Number(id)) ? (nameMap.get(Number(tutorIdMap.get(Number(id)))) || null) : null,
    })).sort((a,b)=> String(a.fullname).localeCompare(String(b.fullname)));

    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/admin/asignaciones/tribunal?careerId=&academicPeriodId=
// Lista estudiantes UIC con tribunal asignado, para tabla en UI.
router.get('/admin/asignaciones/tribunal', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);

    const asigns = await prisma.tribunal_assignments.findMany({
      where: { id_academic_periods: Number(id_ap), id_user_student: { in: estIds } },
      select: { id: true, id_user_student: true, id_president: true, id_secretary: true, id_vocal: true }
    });
    if (!asigns.length) return res.json([]);

    const userIds = Array.from(new Set([
      ...asigns.map(a => Number(a.id_user_student)),
      ...asigns.flatMap(a => [a.id_president, a.id_secretary, a.id_vocal].map(Number))
    ].filter(x => Number.isFinite(Number(x)))));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: userIds } }, select: { usuario_id: true, nombre: true, apellido: true } });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    // nombres carrera (instituto)
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(mods.map(m => m.carrera_id).filter((x)=>Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }

    const modCareerMap = new Map(mods.map(m => [Number(m.estudiante_id), Number(m.carrera_id)]));
    const data = asigns.map(a => {
      const cid = modCareerMap.get(Number(a.id_user_student));
      return {
        id_user: Number(a.id_user_student),
        fullname: nameMap.get(Number(a.id_user_student)) || `Usuario ${a.id_user_student}`,
        career_id: Number.isFinite(Number(cid)) ? Number(cid) : null,
        career_name: Number.isFinite(Number(cid)) ? (careerNameMap[Number(cid)] || null) : null,
        presidente: nameMap.get(Number(a.id_president)) || null,
        secretario: nameMap.get(Number(a.id_secretary)) || null,
        vocal: nameMap.get(Number(a.id_vocal)) || null,
      };
    }).sort((x,y)=> String(x.fullname).localeCompare(String(y.fullname)));

    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/admin/asignaciones/tutor?careerId=&academicPeriodId=
// Lista estudiantes UIC del período que YA tienen tutor asignado
router.get('/admin/asignaciones/tutor', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds }, tutor_usuario_id: { not: null } },
      select: { estudiante_id: true, carrera_id: true, tutor_usuario_id: true }
    });
    if (asigns.length === 0) return res.json([]);

    const estudiantes = await prisma.usuarios.findMany({
      where: { usuario_id: { in: Array.from(new Set(asigns.map(a => a.estudiante_id))) } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const estNameMap = new Map(estudiantes.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const tutorIds = Array.from(new Set(asigns.map(a => a.tutor_usuario_id).filter(x => Number.isFinite(Number(x)))));
    const tutores = tutorIds.length
      ? await prisma.usuarios.findMany({ where: { usuario_id: { in: tutorIds } }, select: { usuario_id: true, nombre: true, apellido: true } })
      : [];
    const tutorNameMap = new Map(tutores.map(t => [t.usuario_id, `${t.nombre} ${t.apellido}`.trim()]));

    // nombres carrera (instituto)
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(asigns.map(a => a.carrera_id).filter(x => Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }

    const data = asigns.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: estNameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
      career_id: a.carrera_id ?? null,
      career_name: a.carrera_id ? (careerNameMap[a.carrera_id] || null) : null,
      tutor_id: a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
      tutor_name: a.tutor_usuario_id ? (tutorNameMap.get(Number(a.tutor_usuario_id)) || null) : null,
    })).sort((x,y)=> String(x.fullname).localeCompare(String(y.fullname)));

    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/admin/asignaciones/lector?careerId=&academicPeriodId=
// Lista estudiantes UIC del período que YA tienen lector asignado
router.get('/admin/asignaciones/lector', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds }, lector_usuario_id: { not: null } },
      select: { estudiante_id: true, carrera_id: true, tutor_usuario_id: true, lector_usuario_id: true }
    });
    if (asigns.length === 0) return res.json([]);

    const estudiantes = await prisma.usuarios.findMany({
      where: { usuario_id: { in: Array.from(new Set(asigns.map(a => a.estudiante_id))) } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const estNameMap = new Map(estudiantes.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const lectorIds = Array.from(new Set(asigns.map(a => a.lector_usuario_id).filter(x => Number.isFinite(Number(x)))));
    const lectores = lectorIds.length
      ? await prisma.usuarios.findMany({ where: { usuario_id: { in: lectorIds } }, select: { usuario_id: true, nombre: true, apellido: true } })
      : [];
    const lectorNameMap = new Map(lectores.map(t => [t.usuario_id, `${t.nombre} ${t.apellido}`.trim()]));

    const tutorIds = Array.from(new Set(asigns.map(a => a.tutor_usuario_id).filter(x => Number.isFinite(Number(x)))));
    const tutores = tutorIds.length
      ? await prisma.usuarios.findMany({ where: { usuario_id: { in: tutorIds } }, select: { usuario_id: true, nombre: true, apellido: true } })
      : [];
    const tutorNameMap = new Map(tutores.map(t => [t.usuario_id, `${t.nombre} ${t.apellido}`.trim()]));

    // nombres carrera (instituto)
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(asigns.map(a => a.carrera_id).filter(x => Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }

    const data = asigns.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: estNameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
      career_id: a.carrera_id ?? null,
      career_name: a.carrera_id ? (careerNameMap[a.carrera_id] || null) : null,
      tutor_id: a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
      tutor_name: a.tutor_usuario_id ? (tutorNameMap.get(Number(a.tutor_usuario_id)) || null) : null,
      lector_id: a.lector_usuario_id != null ? Number(a.lector_usuario_id) : null,
      lector_name: a.lector_usuario_id ? (lectorNameMap.get(Number(a.lector_usuario_id)) || null) : null,
    })).sort((x,y)=> String(x.fullname).localeCompare(String(y.fullname)));

    res.json(data);
  } catch (err) { next(err); }
});

// PUT /uic/admin/asignaciones/lector  Body: { id_user_student, lector_usuario_id, academicPeriodId? }
router.put('/admin/asignaciones/lector', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), lector_usuario_id: z.coerce.number().int(), academicPeriodId: z.coerce.number().int().optional() });
    const { id_user_student, lector_usuario_id, academicPeriodId } = schema.parse(req.body || {});
    // período
    let id_ap = Number.isFinite(Number(academicPeriodId)) ? Number(academicPeriodId) : undefined;
    if (!Number.isFinite(id_ap)) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo configurado'); e.status=400; throw e; }
    // upsert
    const key = { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) };
    const existing = await prisma.uic_asignaciones.findUnique({ where: { periodo_id_estudiante_id: key }, select: { uic_asignacion_id: true, lector_usuario_id: true, tutor_usuario_id: true } });

    // Regla: un mismo docente no puede ser Tutor y Lector del mismo estudiante
    if (existing?.tutor_usuario_id && Number(existing.tutor_usuario_id) === Number(lector_usuario_id)) {
      const e = new Error('El Lector no puede ser el mismo docente asignado como Tutor');
      e.status = 400;
      throw e;
    }

    let saved;
    if (existing) {
      saved = await prisma.uic_asignaciones.update({ where: { periodo_id_estudiante_id: key }, data: { lector_usuario_id: Number(lector_usuario_id) }, select: { uic_asignacion_id: true } });
    } else {
      saved = await prisma.uic_asignaciones.create({ data: { ...key, carrera_id: 0, lector_usuario_id: Number(lector_usuario_id) }, select: { uic_asignacion_id: true } });
    }
    // Notificar lector y estudiante (no bloquear)
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({ id_user: Number(id_user_student), type: 'asignacion_actualizada', title: 'Lector asignado', message: 'Se te ha asignado un Lector para la UIC', entity_type: 'uic_asignacion', entity_id: Number(saved.uic_asignacion_id) });
      await notifications.create({ id_user: Number(lector_usuario_id), type: 'asignacion_tribunal', title: 'Asignado como Lector', message: `Has sido asignado como Lector del estudiante ${id_user_student}`, entity_type: 'uic_asignacion', entity_id: Number(saved.uic_asignacion_id) });
    } catch (_) {}
    res.json({ ok: true });
  } catch (err) { if (err.name==='ZodError'){ err.status=400; err.message=err.errors.map(e=>e.message).join(', ');} next(err); }
});
    const { id_user_student } = schema.parse(req.body || {});
    try {
      const notifications = require("../services/notificationsService");
      await notifications.create({
        id_user: Number(id_user_student),
        type: "informe_requerido",
        title: "Informe final requerido",
        message: "Se ha requerido la entrega de tu informe final",
        entity_type: "uic_informe",
        entity_id: 0,
      });
    } catch (_) {}
    res.status(201).json({ ok: true });
  } catch (err) { if (err.name === "ZodError") { err.status = 400; err.message = err.errors.map(e=>e.message).join(", "); } next(err); }
});

// GET /uic/admin/estudiantes-con-tutor?careerId=&academicPeriodId=
router.get("/admin/estudiantes-con-tutor", authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(id_ap)) {
      const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
      id_ap = per?.periodo_id;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);
    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds }, tutor_usuario_id: { not: null } },
      select: { estudiante_id: true, tutor_usuario_id: true }
    });
    const withTutorIds = asigns.map(a => a.estudiante_id);
    if (withTutorIds.length === 0) return res.json([]);

    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: Array.from(new Set([...withTutorIds, ...asigns.map(a=>a.tutor_usuario_id).filter(Boolean)])) } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    // Mapear carreras
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(mods.map(m => m.carrera_id).filter((x)=>Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) {
          for (const r of rows) { careerNameMap[Number(r.id)] = String(r.nombre); }
        }
      }
    } catch (_) { careerNameMap = {}; }

    const results = [];
    for (const a of asigns) {
      const mod = mods.find(m => m.estudiante_id === a.estudiante_id);
      const cid = mod?.carrera_id ?? null;
      results.push({
        id_user: a.estudiante_id,
        fullname: nameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
        career_id: cid,
        career_name: cid && careerNameMap[cid] ? careerNameMap[cid] : null,
        tutor_id: a.tutor_usuario_id,
        tutor_name: nameMap.get(Number(a.tutor_usuario_id)) || null,
      });
    }
    results.sort((a,b)=> a.fullname.localeCompare(b.fullname));
    res.json(results);
  } catch (err) { next(err); }
});

// GET /uic/admin/dashboard?academicPeriodId=
router.get("/admin/dashboard", authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(id_ap)) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json({ totalEnProceso: 0, sinTutor: 0, totalEstudiantes: 0, uicPercent: 0, complexivoPercent: 0 });

    // estudiantes por modalidad en el período
    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap) },
      select: { estudiante_id: true, modalidad: true }
    });
    const total = mods.length;
    const uicCount = mods.filter(m => String(m.modalidad) === 'UIC').length;
    const complexivoCount = mods.filter(m => String(m.modalidad) !== 'UIC').length;
    const uicPercent = total > 0 ? Math.round((uicCount * 100) / total) : 0;
    const complexivoPercent = total > 0 ? Math.max(0, 100 - uicPercent) : 0;

    // sin tutor: sobre estudiantes del período en UIC sin asignación de tutor
    const uicEst = new Set(mods.filter(m => String(m.modalidad) === 'UIC').map(m => m.estudiante_id));
    let sinTutor = 0;
    if (uicEst.size > 0) {
      const asigns = await prisma.uic_asignaciones.findMany({
        where: { periodo_id: Number(id_ap), estudiante_id: { in: Array.from(uicEst) } },
        select: { estudiante_id: true, tutor_usuario_id: true }
      });
      // contar los que no tienen fila o tienen tutor null
      const withTutor = new Set(asigns.filter(a => Number.isFinite(Number(a.tutor_usuario_id))).map(a => a.estudiante_id));
      sinTutor = Array.from(uicEst).filter(eid => !withTutor.has(eid)).length;
    }

    // total en proceso: por ahora igual a total estudiantes del período (ajustable si hay estados)
    const totalEnProceso = total;
    const totalEstudiantes = total;

    res.json({ totalEnProceso, sinTutor, totalEstudiantes, uicPercent, complexivoPercent });
  } catch (err) { next(err); }
});

// GET /uic/admin/carreras (desde esquema externo si existe)
router.get("/admin/carreras", authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS ORDER BY nombre ASC`);
      return res.json(Array.isArray(rows) ? rows : []);
    } catch (_) {
      return res.json([]);
    }
  } catch (err) { next(err); }
});

// GET /uic/admin/docentes (usuarios con rol Docente activos)
router.get("/admin/docentes", authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    // Intentar primero desde BD del instituto (lectura)
    try {
      const inst = await prisma.$queryRawUnsafe(`
        SELECT
          ID_USUARIOS AS id,
          NOMBRES_USUARIOS AS nombres,
          APELLIDOS_USUARIOS AS apellidos,
          CORREO_USUARIOS AS correo
        FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS
        WHERE (STATUS_USUARIOS='ACTIVO' OR STATUS_USUARIOS IS NULL)
          AND ID_PERFILES_USUARIOS = 15
        ORDER BY APELLIDOS_USUARIOS ASC, NOMBRES_USUARIOS ASC
      `);

      const list = Array.isArray(inst) ? inst : [];

      // Asegurar que exista el rol Docente en BD local
      const docenteRole = await prisma.roles.findFirst({ where: { nombre: 'Docente' }, select: { rol_id: true, nombre: true } });

      // Sincronizar a local (mínimo) para que las asignaciones funcionen
      // Nota: usamos el mismo ID del instituto como usuario_id local.
      for (const r of list) {
        const id = Number(r.id);
        if (!Number.isFinite(id)) continue;
        const nombre = String(r.nombres || '').trim();
        const apellido = String(r.apellidos || '').trim();
        const correo = r.correo != null ? String(r.correo).trim() : null;

        await prisma.usuarios.upsert({
          where: { usuario_id: id },
          update: { nombre, apellido, correo, activo: true },
          create: { usuario_id: id, nombre, apellido, correo, activo: true, clave: '' },
          select: { usuario_id: true }
        });

        if (docenteRole?.rol_id) {
          const has = await prisma.usuario_roles.findFirst({ where: { usuario_id: id, rol_id: docenteRole.rol_id }, select: { usuario_rol_id: true } });
          if (!has) {
            await prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: docenteRole.rol_id } });
          }
        }
      }

      const data = list
        .map(r => ({
          id_user: Number(r.id),
          fullname: `${String(r.nombres || '')} ${String(r.apellidos || '')}`.trim(),
          email: r.correo != null ? String(r.correo) : null,
        }))
        .filter(x => Number.isFinite(Number(x.id_user)));

      return res.json(data);
    } catch (_) {
      // Fallback: docentes locales
      const rows = await prisma.usuarios.findMany({
        where: { activo: true, usuario_roles: { some: { roles: { nombre: 'Docente' } } } },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true },
        orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }]
      });
      const data = rows.map(r => ({ id_user: r.usuario_id, fullname: `${r.nombre} ${r.apellido}`.trim(), email: r.correo || null }));
      return res.json(data);
    }
  } catch (err) { next(err); }
});

// GET /uic/admin/estudiantes-sin-tutor?careerId=
router.get("/admin/estudiantes-sin-tutor", authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(id_ap)) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);
    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'UIC', ...(Number.isFinite(careerId) ? { carrera_id: Number(careerId) } : {}) },
      select: { estudiante_id: true, carrera_id: true }
    });
    const estIds = mods.map(m => m.estudiante_id);
    if (estIds.length === 0) return res.json([]);
    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds } },
      select: { estudiante_id: true, tutor_usuario_id: true }
    });
    const sinTutorIds = new Set(estIds.filter(eid => {
      const a = asigns.find(a => a.estudiante_id === eid);
      return !a || !Number.isFinite(Number(a.tutor_usuario_id));
    }));
    const sinTutorArr = Array.from(sinTutorIds);
    if (sinTutorArr.length === 0) return res.json([]);
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: sinTutorArr } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    // Mapear nombres de carrera
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(mods.map(m => m.carrera_id).filter((x)=>Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) {
          for (const r of rows) { careerNameMap[Number(r.id)] = String(r.nombre); }
        }
      }
    } catch (_) { careerNameMap = {}; }
    // sugerido/carrera desde uic_topics (formulario UIC)
    const results = [];
    for (const u of usuarios) {
      let sugerido = null;
      let carreraForm = null;
      try {
        const t = await prisma.uic_topics.findUnique({
          where: { id_user_id_academic_periods: { id_user: Number(u.usuario_id), id_academic_periods: Number(id_ap) } },
          select: { id_tutor: true, career: true }
        });
        if (t?.career) carreraForm = String(t.career);
        if (t && Number.isFinite(Number(t.id_tutor))) {
          const tu = await prisma.usuarios.findUnique({ where: { usuario_id: Number(t.id_tutor) }, select: { nombre: true, apellido: true } });
          if (tu) sugerido = `${tu.nombre} ${tu.apellido}`.trim();
        }
      } catch (_) {}
      const mod = mods.find(m => m.estudiante_id === u.usuario_id);
      const cid = mod?.carrera_id ?? null;
      const cname = carreraForm || (cid && careerNameMap[cid] ? careerNameMap[cid] : null);
      results.push({ id_user: u.usuario_id, fullname: `${u.nombre} ${u.apellido}`.trim(), career_id: cid, career_name: cname, suggested_tutor: sugerido });
    }
    results.sort((a,b)=> a.fullname.localeCompare(b.fullname));
    res.json(results);
  } catch (err) { next(err); }
});

// PUT /uic/admin/asignaciones/tutor (asignar/cambiar tutor para estudiante en período activo)
router.put("/admin/asignaciones/tutor", authorize('Coordinador', 'Administrador'), async (req, res, next) => {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), tutor_usuario_id: z.coerce.number().int(), academicPeriodId: z.coerce.number().int().optional() });
    const { id_user_student, tutor_usuario_id, academicPeriodId } = schema.parse(req.body || {});
    // Obtener período (override o activo)
    let id_ap = Number.isFinite(Number(academicPeriodId)) ? Number(academicPeriodId) : undefined;
    if (!Number.isFinite(id_ap)) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) { const e = new Error('No hay período activo configurado'); e.status = 400; throw e; }
    // Upsert en uic_asignaciones
    const current = await prisma.uic_asignaciones.findUnique({
      where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
      select: { tutor_usuario_id: true, lector_usuario_id: true }
    });

    // Regla: un mismo docente no puede ser Tutor y Lector del mismo estudiante
    if (current?.lector_usuario_id && Number(current.lector_usuario_id) === Number(tutor_usuario_id)) {
      const e = new Error('El Tutor no puede ser el mismo docente asignado como Lector');
      e.status = 400;
      throw e;
    }

    const prevTutor = current?.tutor_usuario_id ?? null;
    let saved;
    if (current) {
      saved = await prisma.uic_asignaciones.update({
        where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
        data: { tutor_usuario_id: Number(tutor_usuario_id) },
        select: { periodo_id: true, estudiante_id: true, tutor_usuario_id: true }
      });
    } else {
      saved = await prisma.uic_asignaciones.create({
        data: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student), carrera_id: 0, tutor_usuario_id: Number(tutor_usuario_id) },
        select: { periodo_id: true, estudiante_id: true, tutor_usuario_id: true }
      });
    }
    // Notificaciones (no bloquear)
    try {
      const notifications = require("../services/notificationsService");
      // Estudiante
      await notifications.create({
        id_user: Number(id_user_student),
        type: 'asignacion_actualizada',
        title: 'Tutor asignado',
        message: 'Se te ha asignado un tutor para la UIC',
        entity_type: 'uic_asignacion',
        entity_id: 0,
      });
      // Nuevo Tutor
      await notifications.create({
        id_user: Number(tutor_usuario_id),
        type: 'asignacion_tribunal',
        title: 'Asignado como Tutor',
        message: `Has sido asignado como Tutor del estudiante ${id_user_student}`,
        entity_type: 'uic_asignacion',
        entity_id: 0,
      });
      // Tutor anterior (si cambió)
      if (prevTutor && Number(prevTutor) !== Number(tutor_usuario_id)) {
        await notifications.create({
          id_user: Number(prevTutor),
          type: 'asignacion_actualizada',
          title: 'Removido de tutoría',
          message: `Ya no eres Tutor del estudiante ${id_user_student}`,
          entity_type: 'uic_asignacion',
          entity_id: 0,
        });
      }
    } catch (_) { /* no bloquear */ }
    res.json({ ok: true, previoTutorId: prevTutor ?? null, nuevoTutorId: Number(tutor_usuario_id) });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e=>e.message).join(', ');} next(err); }
});

// GET /uic/docentes (lista para selector en formulario de estudiante)
router.get("/docentes", authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        ID_USUARIOS AS id,
        NOMBRES_USUARIOS AS nombres,
        APELLIDOS_USUARIOS AS apellidos
      FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS
      WHERE (STATUS_USUARIOS='ACTIVO' OR STATUS_USUARIOS IS NULL)
        AND ID_PERFILES_USUARIOS = 15
      ORDER BY APELLIDOS_USUARIOS ASC, NOMBRES_USUARIOS ASC
    `);

    const list = Array.isArray(rows) ? rows : [];

    // Sincronizar mínimo a BD local para que uic_topics.id_tutor (FK a usuarios) no falle
    const docenteRole = await prisma.roles.findFirst({ where: { nombre: 'Docente' }, select: { rol_id: true } });
    for (const r of list) {
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      const nombre = String(r.nombres || '').trim();
      const apellido = String(r.apellidos || '').trim();

      await prisma.usuarios.upsert({
        where: { usuario_id: id },
        update: { nombre, apellido, activo: true },
        create: { usuario_id: id, nombre, apellido, correo: null, activo: true, clave: '' },
        select: { usuario_id: true }
      });

      if (docenteRole?.rol_id) {
        const has = await prisma.usuario_roles.findFirst({ where: { usuario_id: id, rol_id: docenteRole.rol_id }, select: { usuario_rol_id: true } });
        if (!has) {
          await prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: docenteRole.rol_id } });
        }
      }
    }

    const data = list
      .map(r => ({ id_user: Number(r.id), fullname: `${String(r.nombres || '')} ${String(r.apellidos || '')}`.trim() }))
      .filter(x => Number.isFinite(Number(x.id_user)));

    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/carreras (catálogo para selector en formulario de estudiante)
router.get("/carreras", authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS ORDER BY nombre ASC`);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) { next(err); }
});

// GET /uic/topic (mi formulario si existe)
router.get("/topic", authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const id_user = req.user?.sub;
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    const per = ap?.setting_value ? (typeof ap.setting_value === "string" ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    if (!per?.id_academic_periods) return res.json(null);
    const row = await prisma.uic_topics.findUnique({
      where: { id_user_id_academic_periods: { id_user, id_academic_periods: per.id_academic_periods } },
      select: { id: true, career: true, topic: true, id_tutor: true, status: true },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// POST /uic/topic (crear/actualizar mi formulario)
router.post("/topic", authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const schema = z.object({
      career: z.string().min(1),
      topic: z.string().min(1),
      id_tutor: z.coerce.number().int(),
    });
    const { career, topic, id_tutor } = schema.parse(req.body || {});
    const id_user = req.user?.sub;
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    const per = ap?.setting_value ? (typeof ap.setting_value === "string" ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    if (!per?.id_academic_periods) {
      const err = new Error("No hay período activo configurado");
      err.status = 400; throw err;
    }
    const saved = await prisma.uic_topics.upsert({
      where: { id_user_id_academic_periods: { id_user, id_academic_periods: per.id_academic_periods } },
      create: { id_user, id_academic_periods: per.id_academic_periods, career, topic, id_tutor },
      update: { career, topic, id_tutor },
      select: { id: true, career: true, topic: true, id_tutor: true, status: true },
    });
    res.status(201).json(saved);
  } catch (err) { if (err.name === "ZodError") { err.status = 400; err.message = err.errors.map(e=>e.message).join(", "); } next(err); }
});

// A partir de aquí, rutas de estudiante UIC
router.use(requireModality("UIC"));

// GET /uic/estudiante/avance - notas por parcial y tutor para el estudiante autenticado en el período activo
router.get('/estudiante/avance', authorize('Estudiante','Administrador','Coordinador'), async (req, res, next) => {
  const fallback = { tutorNombre: null, p1: null, p2: null, p3: null };
  try {
    const me = req.user?.sub;
    const estudianteId = Number(me);
    if (!Number.isFinite(estudianteId)) { const e = new Error('No autorizado'); e.status = 401; throw e; }

    // período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) { /* ignore and fallback below */ }
    if (!Number.isFinite(Number(id_ap))) return res.json(fallback);

    let asign;
    try {
      asign = await prisma.uic_asignaciones.findFirst({
        where: { periodo_id: Number(id_ap), estudiante_id: estudianteId },
        select: { uic_asignacion_id: true, tutor_usuario_id: true }
      });
    } catch (_) { return res.json(fallback); }
    if (!asign) return res.json(fallback);

    let tutorNombre = null;
    try {
      if (Number.isFinite(Number(asign.tutor_usuario_id))) {
        const tutor = await prisma.usuarios.findUnique({ where: { usuario_id: Number(asign.tutor_usuario_id) }, select: { nombre: true, apellido: true } });
        tutorNombre = tutor ? `${tutor.nombre} ${tutor.apellido}`.trim() : null;
      }
    } catch (_) { /* keep null */ }

    try {
      const notas = await prisma.uic_tutor_notas.findMany({
        where: { uic_asignacion_id: Number(asign.uic_asignacion_id) },
        select: { parcial: true, nota: true }
      });
      const result = { tutorNombre, p1: null, p2: null, p3: null };
      for (const n of notas) {
        const key = `p${Number(n.parcial)}`;
        if (key === 'p1' || key === 'p2' || key === 'p3') result[key] = n.nota != null ? Number(n.nota) : null;
      }
      return res.json(result);
    } catch (_) {
      return res.json({ ...fallback, tutorNombre });
    }
  } catch (err) { next(err); }
});

router.post("/final/entregado", async (req, res, next) => {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), tutorId: z.coerce.number().int().optional(), lectorId: z.coerce.number().int().optional() });
    const { id_user_student, tutorId, lectorId } = schema.parse(req.body || {});
    try {
      const notifications = require("../services/notificationsService");
      await notifications.notifyRoles({
        roles: ["Coordinador"],
        type: "informe_entregado",
        title: "Informe final entregado",
        message: "Un estudiante ha entregado el informe final",
        entity_type: "uic_informe",
        entity_id: Number(id_user_student),
      });
      // Intentar resolver Tutor y Lector desde uic_asignaciones del período activo
      try {
        const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
        const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
        const id_ap = per?.id_academic_periods;
        if (Number.isFinite(Number(id_ap))) {
          const asign = await prisma.uic_asignaciones.findUnique({
            where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
            select: { tutor_usuario_id: true, lector_usuario_id: true }
          });
          const resolvedTutor = asign?.tutor_usuario_id ?? tutorId;
          const resolvedLector = asign?.lector_usuario_id ?? lectorId;
          if (Number.isFinite(Number(resolvedTutor))) {
            await notifications.create({ id_user: Number(resolvedTutor), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
          }
          if (Number.isFinite(Number(resolvedLector))) {
            await notifications.create({ id_user: Number(resolvedLector), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
          }
        } else {
          // Fallback a IDs proporcionados si no hay período activo
          if (Number.isFinite(Number(tutorId))) {
            await notifications.create({ id_user: Number(tutorId), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
          }
          if (Number.isFinite(Number(lectorId))) {
            await notifications.create({ id_user: Number(lectorId), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
          }
        }
      } catch (_) {
        // Fallback silencioso a IDs proporcionados si falla consulta
        if (Number.isFinite(Number(tutorId))) {
          await notifications.create({ id_user: Number(tutorId), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
        }
        if (Number.isFinite(Number(lectorId))) {
          await notifications.create({ id_user: Number(lectorId), type: "informe_entregado", title: "Informe final entregado", message: "El estudiante entregó el informe final", entity_type: "uic_informe", entity_id: Number(id_user_student) });
        }
      }
    } catch (_) {}
    res.status(201).json({ ok: true });
  } catch (err) { if (err.name === "ZodError") { err.status = 400; err.message = err.errors.map(e=>e.message).join(", "); } next(err); }
});

module.exports = router;
