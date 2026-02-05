const express = require("express");
const router = express.Router();
const { requireModality } = require("../middlewares/requireModality");
const prisma = require("../../prisma/client");
const { z } = require("zod");
const authorize = require("../middlewares/authorize");

function safeSchemaName(name) {
  const s = String(name || '').trim();
  return /^[a-zA-Z0-9_]+$/.test(s) ? s : null;
}

async function getActivePeriodId(overrideAp) {
  let id_ap = Number.isFinite(Number(overrideAp)) ? Number(overrideAp) : undefined;
  if (!Number.isFinite(Number(id_ap))) {
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    id_ap = per?.id_academic_periods;
  }
  return Number.isFinite(Number(id_ap)) ? Number(id_ap) : null;
}

async function getCareerNameMap(careerIds) {
  const ids = Array.from(new Set((careerIds || []).map(n => Number(n)).filter(Number.isFinite)));
  if (!ids.length) return {};
  let map = {};
  try {
    const EXT_SCHEMA = safeSchemaName(process.env.INSTITUTO_SCHEMA) || 'tecnologicolosan_sigala2';
    const inList = ids.join(',');
    const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
    if (Array.isArray(rows)) {
      for (const r of rows) map[Number(r.id)] = String(r.nombre);
    }
  } catch (_) {
    map = {};
  }
  return map;
}

// GET /uic/admin/reportes/general?academicPeriodId=&careerId=
// Lista estudiantes en proceso de titulación (modalidades_elegidas) con carrera y modalidad
router.get('/admin/reportes/general', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const id_ap = await getActivePeriodId(req.query?.academicPeriodId);
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: {
        periodo_id: Number(id_ap),
        ...(Number.isFinite(Number(careerId)) ? { carrera_id: Number(careerId) } : {}),
      },
      select: { estudiante_id: true, carrera_id: true, modalidad: true }
    }).catch(() => []);
    if (!mods.length) return res.json([]);

    const estIds = Array.from(new Set(mods.map(m => Number(m.estudiante_id)).filter(Number.isFinite)));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: estIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    }).catch(() => []);
    const nameMap = new Map((usuarios || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));

    const careerMap = await getCareerNameMap(mods.map(m => m.carrera_id));

    const data = mods.map(m => ({
      id_user: Number(m.estudiante_id),
      estudiante: nameMap.get(Number(m.estudiante_id)) || `Usuario ${m.estudiante_id}`,
      carrera_id: Number(m.carrera_id),
      carrera: careerMap[Number(m.carrera_id)] || null,
      modalidad: String(m.modalidad) === 'UIC' ? 'UIC' : 'Examen Complexivo',
    })).sort((a,b)=> String(a.estudiante).localeCompare(String(b.estudiante)));

    res.json(data);
  } catch (err) { next(err); }
});

// GET /uic/admin/reportes/especifico?academicPeriodId=&careerId=&modalidad=UIC|EXAMEN_COMPLEXIVO
router.get('/admin/reportes/especifico', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const modalidad = String(req.query?.modalidad || '').trim();
    const id_ap = await getActivePeriodId(req.query?.academicPeriodId);
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    if (modalidad === 'EXAMEN_COMPLEXIVO') {
      const mods = await prisma.modalidades_elegidas.findMany({
        where: {
          periodo_id: Number(id_ap),
          modalidad: 'EXAMEN_COMPLEXIVO',
          ...(Number.isFinite(Number(careerId)) ? { carrera_id: Number(careerId) } : {}),
        },
        select: { estudiante_id: true, carrera_id: true, modalidad: true }
      }).catch(() => []);
      if (!mods.length) return res.json([]);

      const estIds = Array.from(new Set(mods.map(m => Number(m.estudiante_id)).filter(Number.isFinite)));
      const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: estIds } }, select: { usuario_id: true, nombre: true, apellido: true } }).catch(() => []);
      const nameMap = new Map((usuarios || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));
      const careerMap = await getCareerNameMap(mods.map(m => m.carrera_id));

      const data = mods.map(m => ({
        id_user: Number(m.estudiante_id),
        estudiante: nameMap.get(Number(m.estudiante_id)) || `Usuario ${m.estudiante_id}`,
        carrera_id: Number(m.carrera_id),
        carrera: careerMap[Number(m.carrera_id)] || null,
        modalidad: 'Examen Complexivo',
      })).sort((a,b)=> String(a.estudiante).localeCompare(String(b.estudiante)));
      return res.json(data);
    }

    // UIC: estudiantes con tutor y tribunal asignados
    const asigns = await prisma.uic_asignaciones.findMany({
      where: {
        periodo_id: Number(id_ap),
        tutor_usuario_id: { not: null },
        ...(Number.isFinite(Number(careerId)) ? { carrera_id: Number(careerId) } : {}),
      },
      select: { uic_asignacion_id: true, estudiante_id: true, carrera_id: true, tutor_usuario_id: true }
    }).catch(() => []);
    if (!asigns.length) return res.json([]);

    const asignIds = Array.from(new Set(asigns.map(a => Number(a.uic_asignacion_id)).filter(Number.isFinite)));
    const miembros = asignIds.length
      ? await prisma.uic_tribunal_miembros.findMany({
          where: { uic_asignacion_id: { in: asignIds } },
          select: { uic_asignacion_id: true, docente_usuario_id: true }
        }).catch(() => [])
      : [];

    const miembrosByAsign = new Map();
    for (const m of (miembros || [])) {
      const aid = Number(m.uic_asignacion_id);
      if (!Number.isFinite(aid)) continue;
      const arr = miembrosByAsign.get(aid) || [];
      arr.push(Number(m.docente_usuario_id));
      miembrosByAsign.set(aid, arr);
    }

    const asignsWithTrib = asigns.filter(a => {
      const arr = miembrosByAsign.get(Number(a.uic_asignacion_id)) || [];
      return Array.isArray(arr) && arr.length > 0;
    });
    if (!asignsWithTrib.length) return res.json([]);

    const userIds = Array.from(new Set([
      ...asignsWithTrib.map(a => Number(a.estudiante_id)),
      ...asignsWithTrib.map(a => Number(a.tutor_usuario_id)).filter(Number.isFinite),
      ...(miembros || []).map(m => Number(m.docente_usuario_id)).filter(Number.isFinite)
    ]));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: userIds } }, select: { usuario_id: true, nombre: true, apellido: true } }).catch(() => []);
    const nameMap = new Map((usuarios || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));
    const careerMap = await getCareerNameMap(asignsWithTrib.map(a => a.carrera_id));

    const data = asignsWithTrib.map(a => {
      const tribIds = (miembrosByAsign.get(Number(a.uic_asignacion_id)) || []).filter(Number.isFinite);
      const tribNames = tribIds.map(id => nameMap.get(Number(id))).filter(Boolean);
      return {
        id_user: Number(a.estudiante_id),
        estudiante: nameMap.get(Number(a.estudiante_id)) || `Usuario ${a.estudiante_id}`,
        carrera_id: Number(a.carrera_id),
        carrera: careerMap[Number(a.carrera_id)] || null,
        modalidad: 'UIC',
        tutor: a.tutor_usuario_id ? (nameMap.get(Number(a.tutor_usuario_id)) || null) : null,
        tribunal: tribNames.join(', '),
      };
    }).sort((x,y)=> String(x.estudiante).localeCompare(String(y.estudiante)));

    res.json(data);
  } catch (err) { next(err); }
});

// Admin endpoint (Coordinación) para requerir informe final
router.post("/admin/final/require", authorize('Coordinador', 'Administrador'), async (req, res, next) => {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int() });
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
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map(e => e.message).join(", ");
    }
    next(err);
  }
});

// GET /uic/admin/estudiantes-uic-sin-tribunal?careerId=&academicPeriodId=
// Lista estudiantes UIC del período/carrera que NO tienen tribunal asignado aún. Incluye tutor asignado.
router.get('/admin/estudiantes-uic-sin-tribunal', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    // Misma lógica base que Asignar Tutor: uic_topics define quién está en UIC en el período.
    // Para Tribunal, un estudiante es elegible si ya tiene tutor (aquí: uic_topics.id_tutor).
    let topics = await prisma.uic_topics.findMany({
      where: {
        id_academic_periods: Number(id_ap),
        ...(careerName ? { career: careerName } : {}),
      },
      select: { id_user: true, id_tutor: true, career: true }
    }).catch(() => []);

    if (!Array.isArray(topics) || topics.length === 0) {
      try {
        const rows = await prisma.$queryRaw`
          SELECT id_user, id_tutor, career
          FROM uic_topics
          WHERE id_academic_periods = ${Number(id_ap)}
          ${careerName ? prisma.$queryRaw`AND career = ${String(careerName)}` : prisma.$queryRaw``}
        `;
        if (Array.isArray(rows)) {
          topics = rows.map(r => ({
            id_user: Number(r.id_user),
            id_tutor: Number(r.id_tutor),
            career: r.career != null ? String(r.career) : null,
          })).filter(t => Number.isFinite(Number(t.id_user)));
        }
      } catch (e) {
        try { console.error('[uic] estudiantes-uic-sin-tribunal raw topics fallback error:', e); } catch (_) {}
      }
    }

    try { if (Array.isArray(topics)) console.log('[uic] estudiantes-uic-sin-tribunal topics:', { id_ap: Number(id_ap), careerName, count: topics.length }); } catch (_) {}

    const estIds = (topics || []).map(t => Number(t.id_user)).filter(n => Number.isFinite(Number(n)));
    if (estIds.length === 0) return res.json([]);

    // Estudiantes con tribunal asignado (UIC): existen miembros en uic_tribunal_miembros para la asignación del período
    const asignsAll = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds.map(Number) } },
      select: { uic_asignacion_id: true, estudiante_id: true }
    }).catch(() => []);
    const asignIdByStudent = new Map((asignsAll || []).map(a => [Number(a.estudiante_id), Number(a.uic_asignacion_id)]));
    const asignIds = Array.from(new Set((asignsAll || []).map(a => Number(a.uic_asignacion_id)).filter(n => Number.isFinite(n))));

    const miembros = asignIds.length
      ? await prisma.uic_tribunal_miembros.findMany({
          where: { uic_asignacion_id: { in: asignIds } },
          select: { uic_asignacion_id: true }
        }).catch(() => [])
      : [];
    const withTribunalAsign = new Set((miembros || []).map(m => Number(m.uic_asignacion_id)));
    const sinTribunalIds = estIds.filter(id => {
      const asigId = asignIdByStudent.get(Number(id));
      return !asigId || !withTribunalAsign.has(Number(asigId));
    });
    if (sinTribunalIds.length === 0) return res.json([]);

    // Si existe uic_asignaciones, se respeta. Si no, se usa el tutor de uic_topics.
    const asigns = await prisma.uic_asignaciones.findMany({
      where: {
        periodo_id: Number(id_ap),
        estudiante_id: { in: sinTribunalIds.map(Number) },
      },
      select: { estudiante_id: true, tutor_usuario_id: true, carrera_id: true }
    }).catch(() => []);

    const tutorIdMapFromAsign = new Map((asigns || [])
      .filter(a => sinTribunalIds.includes(Number(a.estudiante_id)))
      .map(a => [Number(a.estudiante_id), a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null]));

    const tutorIdMapFromTopics = new Map((topics || [])
      .filter(t => sinTribunalIds.includes(Number(t.id_user)))
      .map(t => [Number(t.id_user), t.id_tutor != null ? Number(t.id_tutor) : null]));

    const tutorIdMap = new Map(sinTribunalIds.map(id => [
      Number(id),
      tutorIdMapFromAsign.get(Number(id)) ?? tutorIdMapFromTopics.get(Number(id)) ?? null
    ]));

    const allUserIds = Array.from(new Set([
      ...sinTribunalIds.map(Number),
      ...Array.from(tutorIdMap.values()).filter(x => Number.isFinite(Number(x))).map(Number)
    ]));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: allUserIds } }, select: { usuario_id: true, nombre: true, apellido: true } }).catch(() => []);
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const topicCareerMap = new Map((topics || []).map(t => [Number(t.id_user), String(t.career || '').trim()]));
    const data = sinTribunalIds.map(id => ({
      id_user: Number(id),
      fullname: nameMap.get(Number(id)) || `Usuario ${id}`,
      tutor_id: tutorIdMap.get(Number(id)) ?? null,
      tutor_name: tutorIdMap.get(Number(id)) ? (nameMap.get(Number(tutorIdMap.get(Number(id)))) || null) : null,
      career_id: (asigns && asigns.length)
        ? ((asigns.find(a => Number(a.estudiante_id) === Number(id))?.carrera_id != null)
            ? Number(asigns.find(a => Number(a.estudiante_id) === Number(id))?.carrera_id)
            : (Number.isFinite(Number(careerId)) ? Number(careerId) : null))
        : (Number.isFinite(Number(careerId)) ? Number(careerId) : null),
      career_name: (topicCareerMap.get(Number(id)) || null),
    }));
    res.json(data);
  } catch (err) {
    try { console.error('[uic] estudiantes-uic-sin-tribunal error:', err); } catch (_) {}
    return res.json([]);
  }
});

// GET /uic/admin/asignaciones/tribunal?careerId=&academicPeriodId=
// Lista estudiantes UIC con tribunal asignado, para tabla en UI.
router.get('/admin/asignaciones/tribunal', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), ...(careerName ? { career: careerName } : {}) },
      select: { id_user: true, career: true }
    }).catch(() => []);
    const estIds = topics.map(t => t.id_user);
    if (estIds.length === 0) return res.json([]);

    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));

    const uicAsigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds.map(Number) } },
      select: { uic_asignacion_id: true, estudiante_id: true, carrera_id: true }
    }).catch(() => []);
    if (!uicAsigns.length) return res.json([]);
    const asignIds = Array.from(new Set(uicAsigns.map(a => Number(a.uic_asignacion_id)).filter(n => Number.isFinite(n))));
    if (!asignIds.length) return res.json([]);

    const miembros = await prisma.uic_tribunal_miembros.findMany({
      where: { uic_asignacion_id: { in: asignIds } },
      select: { uic_asignacion_id: true, docente_usuario_id: true, rol_tribunal: true }
    }).catch(() => []);
    if (!miembros.length) return res.json([]);

    const miembrosByAsign = new Map();
    for (const m of (miembros || [])) {
      const aid = Number(m.uic_asignacion_id);
      if (!Number.isFinite(aid)) continue;
      const arr = miembrosByAsign.get(aid) || [];
      arr.push({ docente_usuario_id: Number(m.docente_usuario_id), rol_tribunal: String(m.rol_tribunal) });
      miembrosByAsign.set(aid, arr);
    }

    const userIds = Array.from(new Set([
      ...uicAsigns.map(a => Number(a.estudiante_id)),
      ...(miembros || []).map(m => Number(m.docente_usuario_id)),
    ].filter(x => Number.isFinite(Number(x)))));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: userIds } }, select: { usuario_id: true, nombre: true, apellido: true } }).catch(() => []);
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const asignByStudent = new Map(uicAsigns.map(a => [Number(a.estudiante_id), a]));
    const data = uicAsigns
      .filter(a => miembrosByAsign.has(Number(a.uic_asignacion_id)))
      .map(a => {
        const arr = miembrosByAsign.get(Number(a.uic_asignacion_id)) || [];
        const m1 = arr.find(x => String(x.rol_tribunal) === 'miembro_1');
        const m2 = arr.find(x => String(x.rol_tribunal) === 'miembro_2');
        const m3 = arr.find(x => String(x.rol_tribunal) === 'miembro_3');
        return {
          id_user: Number(a.estudiante_id),
          fullname: nameMap.get(Number(a.estudiante_id)) || `Usuario ${a.estudiante_id}`,
          career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : (a.carrera_id != null ? Number(a.carrera_id) : null),
          career_name: topicCareerMap.get(Number(a.estudiante_id)) || null,
          presidente: m1?.docente_usuario_id ? (nameMap.get(Number(m1.docente_usuario_id)) || null) : null,
          secretario: m2?.docente_usuario_id ? (nameMap.get(Number(m2.docente_usuario_id)) || null) : null,
          vocal: m3?.docente_usuario_id ? (nameMap.get(Number(m3.docente_usuario_id)) || null) : null,
        };
      })
      .sort((x,y)=> String(x.fullname).localeCompare(String(y.fullname)));

    res.json(data);
  } catch (err) {
    try { console.error('[uic] asignaciones/tribunal error:', err); } catch (_) {}
    return res.json([]);
  }
});

// GET /uic/admin/asignaciones/tutor?careerId=&academicPeriodId=
// Lista estudiantes UIC del período que YA tienen tutor asignado
router.get('/admin/asignaciones/tutor', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), ...(careerName ? { career: careerName } : {}) },
      select: { id_user: true, career: true }
    });
    const estIds = topics.map(t => t.id_user);
    if (estIds.length === 0) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds }, tutor_usuario_id: { not: null } },
      select: { estudiante_id: true, tutor_usuario_id: true }
    });
    if (asigns.length === 0) return res.json([]);

    const allUserIds = Array.from(new Set([
      ...asigns.map(a => Number(a.estudiante_id)),
      ...asigns.map(a => Number(a.tutor_usuario_id)).filter(Number.isFinite)
    ]));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: allUserIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));

    const data = asigns.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: nameMap.get(Number(a.estudiante_id)) || `Usuario ${a.estudiante_id}`,
      career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : null,
      career_name: topicCareerMap.get(Number(a.estudiante_id)) || null,
      tutor_id: a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
      tutor_name: a.tutor_usuario_id ? (nameMap.get(Number(a.tutor_usuario_id)) || null) : null,
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
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    const asignsAll = await prisma.uic_asignaciones.findMany({
      where: {
        periodo_id: Number(id_ap),
        lector_usuario_id: { not: null },
      },
      select: { estudiante_id: true, tutor_usuario_id: true, lector_usuario_id: true, carrera_id: true }
    });
    if (asignsAll.length === 0) return res.json([]);

    const estIds = Array.from(new Set(asignsAll.map(a => Number(a.estudiante_id)).filter(Number.isFinite)));

    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), id_user: { in: estIds } },
      select: { id_user: true, career: true }
    });
    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));

    const finalAsigns = Number.isFinite(Number(careerId)) && careerName
      ? asignsAll.filter(a => {
          if (Number.isFinite(Number(a.carrera_id)) && Number(a.carrera_id) === Number(careerId)) return true;
          const cn = topicCareerMap.get(Number(a.estudiante_id));
          return cn && cn === careerName;
        })
      : asignsAll;
    if (finalAsigns.length === 0) return res.json([]);

    const allUserIds = Array.from(new Set([
      ...finalAsigns.map(a => Number(a.estudiante_id)),
      ...finalAsigns.map(a => Number(a.tutor_usuario_id)).filter(Number.isFinite),
      ...finalAsigns.map(a => Number(a.lector_usuario_id)).filter(Number.isFinite),
    ]));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: allUserIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const data = finalAsigns.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: nameMap.get(Number(a.estudiante_id)) || `Usuario ${a.estudiante_id}`,
      career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : null,
      career_name: topicCareerMap.get(Number(a.estudiante_id)) || null,
      tutor_id: a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
      tutor_name: a.tutor_usuario_id ? (nameMap.get(Number(a.tutor_usuario_id)) || null) : null,
      lector_id: a.lector_usuario_id != null ? Number(a.lector_usuario_id) : null,
      lector_name: a.lector_usuario_id ? (nameMap.get(Number(a.lector_usuario_id)) || null) : null,
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

router.get('/admin/estudiantes-sin-lector', authorize('Coordinador','Administrador'), async (req, res, next) => {
  try {
    const careerId = req.query?.careerId ? Number(req.query.careerId) : undefined;
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    let id_ap = Number.isFinite(overrideAp) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    // En lector: deben aparecer estudiantes que YA tienen tutor asignado.
    // Por eso filtramos por uic_asignaciones con tutor != null y lector == null.
    const asignsAll = await prisma.uic_asignaciones.findMany({
      where: {
        periodo_id: Number(id_ap),
        tutor_usuario_id: { not: null },
        lector_usuario_id: null,
      },
      select: { estudiante_id: true, tutor_usuario_id: true, lector_usuario_id: true, carrera_id: true }
    });
    if (asignsAll.length === 0) return res.json([]);

    const sinLectorArrAll = Array.from(new Set(asignsAll.map(a => Number(a.estudiante_id)).filter(Number.isFinite)));
    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), id_user: { in: sinLectorArrAll.map(Number) } },
      select: { id_user: true, career: true }
    });
    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));

    const asigns = Number.isFinite(Number(careerId)) && careerName
      ? asignsAll.filter(a => {
          if (Number.isFinite(Number(a.carrera_id)) && Number(a.carrera_id) === Number(careerId)) return true;
          const cn = topicCareerMap.get(Number(a.estudiante_id));
          return cn && cn === careerName;
        })
      : asignsAll;
    if (asigns.length === 0) return res.json([]);

    const sinLectorArr = Array.from(new Set(asigns.map(a => Number(a.estudiante_id)).filter(Number.isFinite)));
    const tutorIds = Array.from(new Set(asigns.map(a => a.tutor_usuario_id).filter(x => Number.isFinite(Number(x)))));
    const allUserIds = Array.from(new Set([
      ...sinLectorArr.map(Number),
      ...tutorIds.map(Number)
    ]));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: allUserIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const results = sinLectorArr.map(uid => {
      const a = asigns.find(a => a.estudiante_id === uid);
      return {
        id_user: Number(uid),
        fullname: nameMap.get(Number(uid)) || `Usuario ${uid}`,
        career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : null,
        career_name: topicCareerMap.get(Number(uid)) || null,
        tutor_id: a?.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
        tutor_name: a?.tutor_usuario_id ? (nameMap.get(Number(a.tutor_usuario_id)) || null) : null,
      };
    }).sort((a,b)=> a.fullname.localeCompare(b.fullname));

    res.json(results);
  } catch (err) { next(err); }
});

// GET /uic/admin/estudiantes-con-tutor?careerId=&academicPeriodId=
router.get("/admin/estudiantes-con-tutor", authorize('Coordinador','Administrador'), async (req, res, next) => {
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

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), ...(careerName ? { career: careerName } : {}) },
      select: { id_user: true, career: true }
    });
    const estIds = topics.map(t => t.id_user);
    if (estIds.length === 0) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds }, tutor_usuario_id: { not: null } },
      select: { estudiante_id: true, tutor_usuario_id: true }
    });
    if (asigns.length === 0) return res.json([]);

    const allUserIds = Array.from(new Set([
      ...asigns.map(a => Number(a.estudiante_id)),
      ...asigns.map(a => Number(a.tutor_usuario_id)).filter(Number.isFinite)
    ]));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: allUserIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));

    const results = asigns.map(a => ({
      id_user: Number(a.estudiante_id),
      fullname: nameMap.get(Number(a.estudiante_id)) || `Usuario ${a.estudiante_id}`,
      career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : null,
      career_name: topicCareerMap.get(Number(a.estudiante_id)) || null,
      tutor_id: a.tutor_usuario_id != null ? Number(a.tutor_usuario_id) : null,
      tutor_name: a.tutor_usuario_id ? (nameMap.get(Number(a.tutor_usuario_id)) || null) : null,
    })).sort((a,b)=> a.fullname.localeCompare(b.fullname));

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
      if (!list.length) throw new Error('No docentes from institute');

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

        // No permitir que un error de sincronización tumbe el endpoint.
        try {
          await prisma.usuarios.upsert({
            where: { usuario_id: id },
            update: { nombre, apellido, correo, activo: true },
            create: { usuario_id: id, nombre, apellido, correo, activo: true, clave: '' },
            select: { usuario_id: true }
          });
        } catch (_) {
          // Reintentar con un nombre alternativo por si existe restricción UNIQUE (p.ej. nombre)
          try {
            const altNombre = `${nombre || 'Docente'}_${id}`;
            await prisma.usuarios.upsert({
              where: { usuario_id: id },
              update: { nombre: altNombre, apellido, correo, activo: true },
              create: { usuario_id: id, nombre: altNombre, apellido, correo, activo: true, clave: '' },
              select: { usuario_id: true }
            });
          } catch (_) { /* ignorar */ }
        }

        if (docenteRole?.rol_id) {
          try {
            const has = await prisma.usuario_roles.findFirst({ where: { usuario_id: id, rol_id: docenteRole.rol_id }, select: { usuario_rol_id: true } });
            if (!has) {
              await prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: docenteRole.rol_id } });
            }
          } catch (_) { /* ignorar */ }
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

    let careerName = null;
    if (Number.isFinite(Number(careerId))) {
      try {
        const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
        const rows = await prisma.$queryRawUnsafe(`SELECT NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS = ${Number(careerId)} LIMIT 1`);
        if (Array.isArray(rows) && rows[0]?.nombre) careerName = String(rows[0].nombre);
      } catch (_) { careerName = null; }
    }

    const topics = await prisma.uic_topics.findMany({
      where: { id_academic_periods: Number(id_ap), ...(careerName ? { career: careerName } : {}) },
      select: { id_user: true, career: true, id_tutor: true }
    });
    const estIds = topics.map(t => t.id_user);
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

    const suggestedTutorIds = Array.from(new Set(topics.map(t => t.id_tutor).filter(x => Number.isFinite(Number(x)))));
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: Array.from(new Set([...sinTutorArr.map(Number), ...suggestedTutorIds.map(Number)])) } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const topicCareerMap = new Map(topics.map(t => [Number(t.id_user), String(t.career || '').trim()]));
    const topicTutorMap = new Map(topics.map(t => [Number(t.id_user), Number(t.id_tutor)]));

    const results = sinTutorArr.map(uid => {
      const tid = topicTutorMap.get(Number(uid));
      return {
        id_user: Number(uid),
        fullname: nameMap.get(Number(uid)) || `Usuario ${uid}`,
        career_id: Number.isFinite(Number(careerId)) ? Number(careerId) : null,
        career_name: topicCareerMap.get(Number(uid)) || null,
        suggested_tutor: Number.isFinite(Number(tid)) ? (nameMap.get(Number(tid)) || null) : null,
      };
    }).sort((a,b)=> a.fullname.localeCompare(b.fullname));

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

      // No permitir que un error de sincronización tumbe el endpoint.
      try {
        await prisma.usuarios.upsert({
          where: { usuario_id: id },
          update: { nombre, apellido, activo: true },
          create: { usuario_id: id, nombre, apellido, correo: null, activo: true, clave: '' },
          select: { usuario_id: true }
        });
      } catch (_) {
        // Reintentar con un nombre alternativo por si existe restricción UNIQUE (p.ej. nombre)
        try {
          const altNombre = `${nombre || 'Docente'}_${id}`;
          await prisma.usuarios.upsert({
            where: { usuario_id: id },
            update: { nombre: altNombre, apellido, activo: true },
            create: { usuario_id: id, nombre: altNombre, apellido, correo: null, activo: true, clave: '' },
            select: { usuario_id: true }
          });
        } catch (_) { /* ignorar */ }
      }

      if (docenteRole?.rol_id) {
        try {
          const has = await prisma.usuario_roles.findFirst({ where: { usuario_id: id, rol_id: docenteRole.rol_id }, select: { usuario_rol_id: true } });
          if (!has) {
            await prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: docenteRole.rol_id } });
          }
        } catch (_) { /* ignorar */ }
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