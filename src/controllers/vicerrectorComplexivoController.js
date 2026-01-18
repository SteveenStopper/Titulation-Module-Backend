const { z } = require("zod");
const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!setting || !setting.setting_value) return null;
  const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
  return val?.id_academic_periods ?? null;
}

async function ensureLocalDocenteUser({ institutoId, nombres, apellidos, correo }) {
  if (!Number.isFinite(Number(institutoId))) return null;
  const id = Number(institutoId);

  let local = await prisma.usuarios.findUnique({
    where: { usuario_id: id },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
  });

  if (!local) {
    const baseNombre = String(nombres || '').trim() || `Usuario${id}`;
    try {
      local = await prisma.usuarios.create({
        data: {
          usuario_id: id,
          nombre: baseNombre,
          apellido: String(apellidos || '').trim(),
          correo: correo || null,
          activo: true,
        },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
      });
    } catch (_) {
      // Por si el campo "nombre" tiene restricción unique
      local = await prisma.usuarios.create({
        data: {
          usuario_id: id,
          nombre: `${baseNombre}_${id}`,
          apellido: String(apellidos || '').trim(),
          correo: correo || null,
          activo: true,
        },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
      });
    }
  } else {
    try {
      await prisma.usuarios.update({
        where: { usuario_id: id },
        data: {
          correo: correo || local.correo || null,
          apellido: String(apellidos || local.apellido || '').trim(),
          activo: true,
        },
      });
    } catch (_) {}
  }

  // Asegurar rol Docente (si existe)
  try {
    const rol = await prisma.roles.findUnique({ where: { nombre: 'Docente' }, select: { rol_id: true } });
    if (rol?.rol_id) {
      await prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: Number(rol.rol_id) } });
    }
  } catch (_) {
    // ignorar si ya existe
  }

  return local;
}

async function getPeriodIdFromQuery(req) {
  const periodName = (req?.query?.period || '').toString().trim();
  if (periodName) {
    try {
      const per = await prisma.periodos.findFirst({ where: { nombre: periodName }, select: { periodo_id: true } });
      if (per && per.periodo_id) return Number(per.periodo_id);
    } catch (_) {}
  }
  return await getActivePeriodId();
}

async function listMaterias(req, res, next) {
  try {
    const schema = z.object({ careerId: z.coerce.number().int().optional() });
    const { careerId } = schema.parse(req.query || {});
    const id_ap = await getActivePeriodId();
    if (!id_ap) return res.json([]);
    const where = { periodo_id: Number(id_ap), ...(careerId ? { carrera_id: Number(careerId) } : {}) };
    const rows = await prisma.complexivo_materias.findMany({
      where,
      select: { complexivo_materia_id: true, codigo: true, nombre: true, carrera_id: true, docente_usuario_id: true }
    });
    const docentesIds = Array.from(new Set(rows.map(r => r.docente_usuario_id))).filter(n => Number.isFinite(Number(n)));
    const docentes = docentesIds.length ? await prisma.usuarios.findMany({ where: { usuario_id: { in: docentesIds } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const mapDoc = new Map(docentes.map(d => [d.usuario_id, `${d.nombre} ${d.apellido}`.trim()]));
    // Carrera nombre desde esquema externo si existe
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const carIds = Array.from(new Set(rows.map(a => a.carrera_id)));
      if (carIds.length) {
        const inList = carIds.join(',');
        const q = `SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`;
        const result = await prisma.$queryRawUnsafe(q);
        if (Array.isArray(result)) for (const r of result) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) {}
    const data = rows.map(r => ({
      id: r.complexivo_materia_id,
      codigo: r.codigo,
      nombre: r.nombre,
      carrera_id: r.carrera_id,
      carrera: careerNameMap[r.carrera_id] || null,
      tutorId: r.docente_usuario_id ?? null,
      tutorNombre: mapDoc.get(r.docente_usuario_id) || null,
    }));
    res.json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function createMateria(req, res, next) {
  try {
    const schema = z.object({ careerId: z.coerce.number().int(), code: z.string().min(1), name: z.string().min(1), tutorId: z.coerce.number().int().nullable().optional() });
    const { careerId, code, name, tutorId } = schema.parse(req.body || {});
    const id_ap = await getActivePeriodId();
    if (!id_ap) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    // Regla: máximo 4 materias por carrera en el período
    const existingCount = await prisma.complexivo_materias.count({ where: { periodo_id: Number(id_ap), carrera_id: Number(careerId) } });
    if (Number(existingCount) >= 4) {
      const e = new Error('Esta carrera ya tiene 4 materias registradas');
      e.status = 409;
      throw e;
    }

    const created = await prisma.complexivo_materias.create({
      data: { periodo_id: Number(id_ap), carrera_id: Number(careerId), codigo: code, nombre: name, docente_usuario_id: tutorId ? Number(tutorId) : 0 },
      select: { complexivo_materia_id: true, codigo: true, nombre: true, carrera_id: true, docente_usuario_id: true }
    });
    res.status(201).json({ id: created.complexivo_materia_id });
  } catch (e) {
    if (e && e.code === 'P2002') { e.status = 409; e.message = 'Materia ya registrada para la carrera en este período'; }
    if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} 
    next(e);
  }
}

async function updateTutor(req, res, next) {
  try {
    const schema = z.object({ id: z.coerce.number().int(), tutorId: z.coerce.number().int().nullable() });
    const { id, tutorId } = schema.parse({ id: req.params.id, tutorId: req.body?.tutorId });
    const updated = await prisma.complexivo_materias.update({ where: { complexivo_materia_id: id }, data: { docente_usuario_id: tutorId ? Number(tutorId) : 0 }, select: { codigo: true, nombre: true, docente_usuario_id: true } });
    // Notificar al docente asignado (si hay)
    try {
      if (Number.isFinite(Number(updated.docente_usuario_id)) && Number(updated.docente_usuario_id) > 0) {
        const notifications = require('../services/notificationsService');
        await notifications.create({
          id_user: Number(updated.docente_usuario_id),
          type: 'complexivo_tutor_asignado',
          title: 'Asignado como docente de Complexivo',
          message: `Materia: ${updated.codigo || ''} - ${updated.nombre || ''}`.trim(),
          entity_type: 'complexivo_materia',
          entity_id: Number(id),
        });
      }
    } catch (_) { /* no bloquear */ }
    res.json({ ok: true });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function publish(req, res, next) {
  try {
    const schema = z.object({ careerId: z.coerce.number().int() });
    const { careerId } = schema.parse(req.body || {});
    // No hay bandera de publicado en schema; enviamos notificación y devolvemos conteo
    const id_ap = await getActivePeriodId();
    const count = await prisma.complexivo_materias.count({ where: { periodo_id: Number(id_ap), carrera_id: Number(careerId), docente_usuario_id: { gt: 0 } } });
    try {
      const notifications = require('../services/notificationsService');
      // Notificar a docentes ASIGNADOS (no a todos los docentes del sistema)
      const asignadas = await prisma.complexivo_materias.findMany({
        where: { periodo_id: Number(id_ap), carrera_id: Number(careerId), docente_usuario_id: { gt: 0 } },
        select: { docente_usuario_id: true }
      });
      const teacherIds = Array.from(new Set(asignadas.map(a => Number(a.docente_usuario_id)).filter(n => Number.isFinite(n) && n > 0)));
      if (teacherIds.length) {
        await notifications.createManyUsers({ userIds: teacherIds, type: 'complexivo_publicado', title: 'Asignación de materias (Complexivo)', message: `Se publicaron ${count} materias en tu carrera`, entity_type: 'complexivo', entity_id: 0 });
      }
      // Notificar a estudiantes de la carrera con modalidad Complexivo en período activo
      const mods = await prisma.modalidades_elegidas.findMany({
        where: { periodo_id: Number(id_ap), carrera_id: Number(careerId), modalidad: 'EXAMEN_COMPLEXIVO' },
        select: { estudiante_id: true }
      });
      const studentIds = Array.from(new Set(mods.map(m => Number(m.estudiante_id)).filter(n => Number.isFinite(n) && n > 0)));
      if (studentIds.length) {
        await notifications.createManyUsers({ userIds: studentIds, type: 'complexivo_publicado', title: 'Materias de Complexivo publicadas', message: 'Revisa las materias y docentes asignados para tu carrera', entity_type: 'complexivo', entity_id: 0 });
      }
    } catch (_) {}
    res.json({ ok: true, published: count });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

module.exports = { listMaterias, createMateria, updateTutor, publish };

async function listDocentes(req, res, next) {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    const sql = `
      SELECT
        ID_USUARIOS AS id,
        NOMBRES_USUARIOS AS nombres,
        APELLIDOS_USUARIOS AS apellidos,
        CORREO_USUARIOS AS correo
      FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS
      WHERE (STATUS_USUARIOS='ACTIVO' OR STATUS_USUARIOS IS NULL)
        AND ID_PERFILES_USUARIOS = 15
      ORDER BY APELLIDOS_USUARIOS ASC, NOMBRES_USUARIOS ASC
    `;
    const rows = await prisma.$queryRawUnsafe(sql);
    const list = Array.isArray(rows) ? rows : [];

    // Asegurar presencia en BD local para asignación/notificaciones
    for (const r of list) {
      // eslint-disable-next-line no-await-in-loop
      await ensureLocalDocenteUser({ institutoId: Number(r.id), nombres: r.nombres, apellidos: r.apellidos, correo: r.correo });
    }

    const data = list.map(r => ({
      id: Number(r.id),
      nombre: `${String(r.nombres || '').trim()} ${String(r.apellidos || '').trim()}`.trim()
    })).filter(x => Number.isFinite(x.id) && x.id > 0)
      .sort((a,b)=> a.nombre.localeCompare(b.nombre));
    res.json(data);
  } catch (e) { next(e); }
}

async function listCarreras(req, res, next) {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    let rows = [];
    try {
      rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS`);
    } catch (_) { rows = []; }
    const data = Array.isArray(rows) ? rows.map(r => ({ id: Number(r.id), nombre: String(r.nombre) })) : [];
    res.json(data);
  } catch (e) { next(e); }
}

module.exports.listDocentes = listDocentes;
module.exports.listCarreras = listCarreras;

async function listMateriasCatalogo(req, res, next) {
  try {
    const schema = z.object({ careerId: z.coerce.number().int() });
    const { careerId } = schema.parse(req.query || {});
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    const sql = `SELECT DISTINCT C.ID_CURSOS AS id, C.NOMBRE_CURSOS AS nombre
                 FROM ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS FC
                 JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS C ON C.ID_CURSOS = FC.ID_CURSOS_FORMAR_CURSOS
                 WHERE FC.ID_CARRERA_FORMAR_CURSOS = ${Number(careerId)} AND (C.STATUS_CURSOS = 'ACTIVO' OR C.STATUS_CURSOS IS NULL)`;
    const rows = await prisma.$queryRawUnsafe(sql);
    const data = Array.isArray(rows) ? rows.map(r => ({ id: Number(r.id), nombre: String(r.nombre) })) : [];
    res.json(data.sort((a,b)=> a.nombre.localeCompare(b.nombre)));
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e); }
}

module.exports.listMateriasCatalogo = listMateriasCatalogo;

// ====== Reportes (Vicerrectorado) ======
async function reportResumen(req, res, next) {
  try {
    const id_ap = await getPeriodIdFromQuery(req);
    // Carreras activas en Instituto
    let carrerasActivas = 0;
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS`);
      if (Array.isArray(rows) && rows[0]) carrerasActivas = Number(rows[0].n || 0);
    } catch (_) { carrerasActivas = 0; }
    // Materias registradas en período
    const wherePer = id_ap ? { periodo_id: Number(id_ap) } : {};
    const materiasRegistradas = await prisma.complexivo_materias.count({ where: wherePer }).catch(() => 0);
    // Publicables (con tutor asignado)
    const publicables = await prisma.complexivo_materias.count({ where: { ...wherePer, docente_usuario_id: { gt: 0 } } }).catch(() => 0);
    // Tutores disponibles
    const tutoresDisponibles = await prisma.usuarios.count({ where: { activo: true, usuario_roles: { some: { roles: { nombre: 'Docente' } } } } }).catch(() => 0);
    res.json({ carrerasActivas, materiasRegistradas, publicables, tutoresDisponibles });
  } catch (e) { next(e); }
}

async function reportDistribucionCarreras(req, res, next) {
  try {
    const id_ap = await getPeriodIdFromQuery(req);
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    // Traer todas las materias del período con carrera_id
    const rows = await prisma.complexivo_materias.findMany({
      where: id_ap ? { periodo_id: Number(id_ap) } : {},
      select: { carrera_id: true, docente_usuario_id: true }
    });
    const mapCount = new Map(); // carrera_id -> { registradas, publicadas }
    for (const r of rows) {
      const k = Number(r.carrera_id) || 0;
      if (!mapCount.has(k)) mapCount.set(k, { registradas: 0, publicadas: 0 });
      const obj = mapCount.get(k);
      obj.registradas += 1;
      if (Number(r.docente_usuario_id) > 0) obj.publicadas += 1;
    }
    // Obtener nombres de carreras
    const ids = Array.from(mapCount.keys()).filter(n => n);
    let nameMap = {};
    if (ids.length) {
      const inList = ids.join(',');
      try {
        const q = `SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`;
        const list = await prisma.$queryRawUnsafe(q);
        if (Array.isArray(list)) for (const r of list) nameMap[Number(r.id)] = String(r.nombre);
      } catch (_) {}
    }
    const data = Array.from(mapCount.entries()).map(([id, vals]) => ({
      carrera: nameMap[id] || `Carrera ${id}`,
      registradas: vals.registradas,
      publicadas: vals.publicadas,
    })).sort((a,b)=> a.carrera.localeCompare(b.carrera));
    res.json(data);
  } catch (e) { next(e); }
}

async function reportTopTutores(req, res, next) {
  try {
    const id_ap = await getPeriodIdFromQuery(req);
    const rows = await prisma.complexivo_materias.groupBy({
      by: ['docente_usuario_id'],
      where: id_ap ? { periodo_id: Number(id_ap), docente_usuario_id: { gt: 0 } } : { docente_usuario_id: { gt: 0 } },
      _count: { docente_usuario_id: true },
      orderBy: { _count: { docente_usuario_id: 'desc' } }
    });
    const ids = rows.map(r => Number(r.docente_usuario_id)).filter(n => n);
    const usuarios = ids.length ? await prisma.usuarios.findMany({ where: { usuario_id: { in: ids } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const mapName = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const data = rows.map(r => ({ tutor: mapName.get(Number(r.docente_usuario_id)) || `Docente ${r.docente_usuario_id}`, asignadas: r._count.docente_usuario_id }))
      .sort((a,b)=> b.asignadas - a.asignadas)
      .slice(0, 10);
    res.json(data);
  } catch (e) { next(e); }
}

module.exports.reportResumen = reportResumen;
module.exports.reportDistribucionCarreras = reportDistribucionCarreras;
module.exports.reportTopTutores = reportTopTutores;
