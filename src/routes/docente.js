const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const authorize = require("../middlewares/authorize");
const fs = require('fs');
const path = require('path');

function getEffectiveDocenteId(req) {
  const me = req.user?.sub;
  const roles = Array.isArray(req.user?.roles)
    ? req.user.roles.map(String)
    : (req.user?.role ? [String(req.user.role)] : []);
  const isAdmin = roles.includes('Administrador') || roles.includes('Admin') || roles.includes('ADMIN');
  const asDocenteId = req.query?.asDocenteId != null ? Number(req.query.asDocenteId) : NaN;
  if (isAdmin && Number.isFinite(asDocenteId)) return asDocenteId;
  return me;
}

function toAbsoluteUploadPath(relPath) {
  if (!relPath) return null;
  const cleaned = String(relPath).replace(/^[/\\]+/, "");
  return path.join(process.cwd(), cleaned);
}

// GET /docente/admin/docentes
// Lista docentes desde la BD local (usuarios con rol Docente). Solo Administrador.
router.get('/admin/docentes', authorize('Administrador'), async (req, res, next) => {
  try {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
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
      const data = list
        .map(r => ({
          id_user: Number(r.id),
          fullname: `${String(r.nombres || '')} ${String(r.apellidos || '')}`.trim(),
          email: r.correo != null ? String(r.correo) : null,
        }))
        .filter(x => Number.isFinite(Number(x.id_user)));
      return res.json(data);
    } catch (_) {
      const rows = await prisma.usuarios.findMany({
        where: { activo: true, usuario_roles: { some: { roles: { nombre: 'Docente' } } } },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true },
        orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }]
      });
      const data = (rows || [])
        .map(r => ({ id_user: Number(r.usuario_id), fullname: `${r.nombre} ${r.apellido}`.trim(), email: r.correo || null }))
        .filter(x => Number.isFinite(Number(x.id_user)));
      return res.json(data);
    }
  } catch (err) { next(err); }
});

// GET /docente/dashboard
router.get("/dashboard", authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    // Obtener período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}

    // Materias a cargo (Complexivo) en período activo si existe
    let materiasACargo = 0;
    try {
      const where = { docente_usuario_id: Number(me), ...(Number.isFinite(Number(id_ap)) ? { periodo_id: Number(id_ap) } : {}) };
      materiasACargo = await prisma.complexivo_materias.count({ where });
    } catch (_) {}

    // Revisiones pendientes: contar uic_topics donde soy tutor en período activo
    let revisionesPendientes = 0;
    try {
      if (Number.isFinite(Number(id_ap))) {
        revisionesPendientes = await prisma.uic_topics.count({ where: { id_tutor: Number(me), id_academic_periods: Number(id_ap) } });
      } else {
        revisionesPendientes = await prisma.uic_topics.count({ where: { id_tutor: Number(me) } });
      }
    } catch (_) {}

    // Tutorías próximas: placeholder 0 (no hay agenda en el esquema)
    const tutoriasProximas = 0;

    res.json({ tutoriasProximas, revisionesPendientes, materiasACargo });
  } catch (err) { next(err); }
});

// GET /docente/uic/informe/:estudianteId
// Devuelve metadata del informe final (uic_final) del estudiante si existe y si el docente autenticado es su tutor en el período activo
router.get('/uic/informe/:estudianteId', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = Number(req.params.estudianteId);
    if (!Number.isFinite(estudianteId)) { const e=new Error('Parámetro inválido'); e.status=400; throw e; }

    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), tutor_usuario_id: Number(me), estudiante_id: Number(estudianteId) },
      select: { uic_asignacion_id: true }
    });
    if (!asign) { const e=new Error('Estudiante no asignado a su tutoría'); e.status=404; throw e; }

    const doc = await prisma.documentos.findFirst({
      where: { usuario_id: Number(estudianteId), tipo: 'uic_final' },
      orderBy: { creado_en: 'desc' },
      select: { documento_id: true, nombre_archivo: true, mime_type: true, creado_en: true, estado: true }
    });
    if (!doc) return res.json({ documento_id: null });
    res.json({ documento_id: Number(doc.documento_id), nombre_archivo: doc.nombre_archivo ?? null, mime_type: doc.mime_type ?? null, creado_en: doc.creado_en ?? null, estado: doc.estado ?? null });
  } catch (err) { next(err); }
});

// GET /docente/uic/informe/:estudianteId/download
// Descarga el PDF del informe final del estudiante si existe y si el docente autenticado es su tutor en el período activo
router.get('/uic/informe/:estudianteId/download', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = Number(req.params.estudianteId);
    if (!Number.isFinite(estudianteId)) { const e=new Error('Parámetro inválido'); e.status=400; throw e; }

    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), tutor_usuario_id: Number(me), estudiante_id: Number(estudianteId) },
      select: { uic_asignacion_id: true }
    });
    if (!asign) { const e=new Error('Estudiante no asignado a su tutoría'); e.status=404; throw e; }

    const doc = await prisma.documentos.findFirst({
      where: { usuario_id: Number(estudianteId), tipo: 'uic_final' },
      orderBy: { creado_en: 'desc' },
      select: { documento_id: true, ruta_archivo: true, nombre_archivo: true, mime_type: true }
    });
    if (!doc || !doc.ruta_archivo) { const e=new Error('Documento no encontrado'); e.status=404; throw e; }

    const abs = toAbsoluteUploadPath(doc.ruta_archivo);
    if (!abs || !fs.existsSync(abs)) { const e=new Error('Archivo no encontrado'); e.status=404; throw e; }
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
    const fname = doc.nombre_archivo || `uic_final_${Number(doc.documento_id)}`;
    return res.download(abs, fname);
  } catch (err) { next(err); }
});

// GET /docente/tribunal-evaluador/estudiantes
// Lista estudiantes (y carrera) donde soy miembro del Tribunal Evaluador en el período activo, incluyendo mi rol
router.get('/tribunal-evaluador/estudiantes', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }

    // período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const hasTribunalAssignments = Boolean(prisma?.tribunal_assignments && typeof prisma.tribunal_assignments.findMany === 'function');

    let asigns = [];
    if (hasTribunalAssignments) {
      // Asignaciones guardadas por Coordinador (tabla tribunal_assignments)
      asigns = await prisma.tribunal_assignments.findMany({
        where: {
          id_academic_periods: Number(id_ap),
          OR: [
            { id_president: Number(me) },
            { id_secretary: Number(me) },
            { id_vocal: Number(me) },
          ]
        },
        select: { id_user_student: true, id_president: true, id_secretary: true, id_vocal: true }
      });
    } else {
      // Fallback (UIC): miembros del tribunal por asignación UIC
      const miembros = await prisma.uic_tribunal_miembros.findMany({
        where: { docente_usuario_id: Number(me) },
        select: { uic_asignacion_id: true, rol_tribunal: true }
      }).catch(() => []);
      const asignIds = Array.from(new Set((miembros || []).map(m => Number(m.uic_asignacion_id)).filter(n => Number.isFinite(n))));
      if (asignIds.length > 0) {
        const uicAsigns = await prisma.uic_asignaciones.findMany({
          where: { uic_asignacion_id: { in: asignIds }, periodo_id: Number(id_ap) },
          select: { uic_asignacion_id: true, estudiante_id: true }
        }).catch(() => []);
        const roleByAsign = new Map((miembros || []).map(m => [Number(m.uic_asignacion_id), String(m.rol_tribunal || '')]));
        asigns = (uicAsigns || []).map(a => {
          const rol = roleByAsign.get(Number(a.uic_asignacion_id));
          const rid = String(rol || '');
          return {
            id_user_student: Number(a.estudiante_id),
            id_president: rid === 'miembro_1' ? Number(me) : null,
            id_secretary: rid === 'miembro_2' ? Number(me) : null,
            id_vocal: rid === 'miembro_3' ? Number(me) : null,
          };
        });
      }
    }

    if (!asigns || asigns.length === 0) return res.json([]);

    const estIds = Array.from(new Set(asigns.map(a => Number(a.id_user_student)).filter(x => Number.isFinite(x))));
    if (estIds.length === 0) return res.json([]);

    // carrera del estudiante (desde modalidades_elegidas en período activo)
    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), estudiante_id: { in: estIds } },
      select: { estudiante_id: true, carrera_id: true }
    });
    const careerMap = new Map(mods.map(m => [Number(m.estudiante_id), Number(m.carrera_id)]));
    const carIds = Array.from(new Set(mods.map(m => Number(m.carrera_id)).filter(x => Number.isFinite(x))));

    // nombres estudiantes
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: estIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    // carreras
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      if (carIds.length > 0) {
        const inList = Array.from(carIds).join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) { for (const r of rows) { careerNameMap[Number(r.id)] = String(r.nombre); } }
      }
    } catch (_) { careerNameMap = {}; }

    const roleOf = (a) => {
      if (Number(a.id_president) === Number(me)) return 'Presidente';
      if (Number(a.id_secretary) === Number(me)) return 'Secretario';
      if (Number(a.id_vocal) === Number(me)) return 'Vocal';
      return '';
    };

    const data = asigns
      .map(a => {
        const estId = Number(a.id_user_student);
        const carId = careerMap.get(estId);
        return {
          id: String(estId),
          nombre: nameMap.get(estId) || `Usuario ${estId}`,
          carrera: carId && careerNameMap[carId] ? careerNameMap[carId] : null,
          rol: roleOf(a)
        };
      })
      .sort((a,b)=> a.nombre.localeCompare(b.nombre));

    res.json(data);
  } catch (err) { next(err); }
});

// =============== Docente Veedor (Complexivo) ===============

// GET /docente/veedor/estudiantes
// Devuelve SOLO los nombres de las carreras donde estoy asignado como Veedor en el período activo
router.get('/veedor/estudiantes', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }

    // período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    // Asignaciones guardadas por Coordinador (tabla veedor_assignments)
    const asigns = await prisma.veedor_assignments.findMany({
      where: { id_academic_periods: Number(id_ap), id_user: Number(me) },
      select: { id_career: true }
    });
    if (!asigns || asigns.length === 0) return res.json([]);

    const carIds = Array.from(new Set(asigns.map(a => Number(a.id_career)).filter(x => Number.isFinite(x))));
    if (carIds.length === 0) return res.json([]);

    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const inList = Array.from(carIds).join(',');
      const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList}) ORDER BY nombre ASC`);
      if (Array.isArray(rows)) {
        for (const r of rows) { careerNameMap[Number(r.id)] = String(r.nombre); }
      }
    } catch (_) { careerNameMap = {}; }

    const names = carIds
      .map(id => (careerNameMap[id] ? String(careerNameMap[id]) : null))
      .filter(Boolean);

    res.json(names);
  } catch (err) { next(err); }
});

// GET /docente/uic/estudiantes - estudiantes UIC asignados a mi tutoría en el período activo
router.get("/uic/estudiantes", authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), tutor_usuario_id: Number(me) },
      select: { estudiante_id: true }
    });
    const estIds = Array.from(new Set(asigns.map(a => a.estudiante_id))).filter(x => Number.isFinite(Number(x)));
    if (estIds.length === 0) return res.json([]);

    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: estIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const data = usuarios
      .map(u => ({ id: String(u.usuario_id), nombre: `${u.nombre} ${u.apellido}`.trim() }))
      .sort((a,b)=> a.nombre.localeCompare(b.nombre));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /docente/uic/avances?estudianteId=ID
// Devuelve notas por parcial (1..3) del estudiante asignado al tutor en el período activo
router.get("/uic/avances", authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = req.query?.estudianteId ? Number(req.query.estudianteId) : undefined;
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) return res.json(estudianteId ? { alumnoId: String(estudianteId), p1: null, p2: null, p3: null } : []);

    const asign = await prisma.uic_asignaciones.findFirst({
      where: {
        periodo_id: Number(id_ap),
        tutor_usuario_id: Number(me),
        ...(Number.isFinite(Number(estudianteId)) ? { estudiante_id: Number(estudianteId) } : {})
      },
      select: { uic_asignacion_id: true, estudiante_id: true }
    });

    if (!asign) {
      return res.json(Number.isFinite(Number(estudianteId)) ? { alumnoId: String(estudianteId), p1: null, p2: null, p3: null } : []);
    }

    const notas = await prisma.uic_tutor_notas.findMany({
      where: { uic_asignacion_id: Number(asign.uic_asignacion_id) },
      select: { parcial: true, nota: true, observacion: true }
    });

    // Detectar publicación por parcial: se registra como notificación al estudiante
    // (tutor_parcial_publicado + título "Calificación Parcial X publicada").
    const notifTitles = [1, 2, 3].map((n) => `Calificación Parcial ${n} publicada`);
    const publishedNotifs = await prisma.notificaciones.findMany({
      where: {
        destinatario_usuario_id: Number(asign.estudiante_id),
        destinatario_rol: 'tutor_parcial_publicado',
        titulo: { in: notifTitles },
      },
      select: { titulo: true },
    }).catch(() => []);
    const publishedSet = new Set((publishedNotifs || []).map(n => String(n.titulo || '')));
    const resObj = {
      alumnoId: String(asign.estudiante_id),
      p1: null,
      p2: null,
      p3: null,
    };
    for (const n of notas) {
      const key = `p${Number(n.parcial)}`;
      if (key === 'p1' || key === 'p2' || key === 'p3') {
        const parcialNum = Number(n.parcial);
        const title = `Calificación Parcial ${parcialNum} publicada`;
        resObj[key] = {
          nota: n.nota ? Number(n.nota) : null,
          obs: n.observacion || '',
          published: (n.nota !== null && n.nota !== undefined) && publishedSet.has(title),
        };
      }
    }

    // Si no existe registro en uic_tutor_notas, aún así devolver published=false explícito
    if (!resObj.p1) resObj.p1 = { nota: null, obs: '', published: false };
    if (!resObj.p2) resObj.p2 = { nota: null, obs: '', published: false };
    if (!resObj.p3) resObj.p3 = { nota: null, obs: '', published: false };
    res.json(resObj);
  } catch (err) { next(err); }
});

// PUT /docente/uic/avances/:estudianteId/:parcial
// Body: { nota: number|null, observacion?: string }
router.put("/uic/avances/:estudianteId/:parcial", authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = Number(req.params.estudianteId);
    const parcialNum = Number(req.params.parcial);
    if (!Number.isFinite(estudianteId) || ![1,2,3].includes(parcialNum)) { const e=new Error('Parámetros inválidos'); e.status=400; throw e; }
    const { nota, observacion } = req.body || {};
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), tutor_usuario_id: Number(me), estudiante_id: Number(estudianteId) },
      select: { uic_asignacion_id: true }
    });
    if (!asign) { const e=new Error('Estudiante no asignado a su tutoría'); e.status=404; throw e; }

    // Upsert nota
    const existing = await prisma.uic_tutor_notas.findUnique({
      where: { uic_asignacion_id_parcial: { uic_asignacion_id: Number(asign.uic_asignacion_id), parcial: parcialNum } }
    });
    let saved;
    if (existing) {
      saved = await prisma.uic_tutor_notas.update({
        where: { uic_asignacion_id_parcial: { uic_asignacion_id: Number(asign.uic_asignacion_id), parcial: parcialNum } },
        data: { nota: nota === null || nota === undefined ? null : Number(nota), observacion: observacion ?? existing.observacion }
      });
    } else {
      saved = await prisma.uic_tutor_notas.create({
        data: { uic_asignacion_id: Number(asign.uic_asignacion_id), parcial: parcialNum, nota: nota === null || nota === undefined ? 0 : Number(nota), observacion: observacion ?? null }
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /docente/uic/avances/:estudianteId/:parcial/publicar
// Envía una notificación al estudiante indicando que se publicó la calificación del parcial
router.post("/uic/avances/:estudianteId/:parcial/publicar", authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = Number(req.params.estudianteId);
    const parcialNum = Number(req.params.parcial);
    if (!Number.isFinite(estudianteId) || ![1,2,3].includes(parcialNum)) { const e=new Error('Parámetros inválidos'); e.status=400; throw e; }

    // periodo activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    // verificar asignación
    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), tutor_usuario_id: Number(me), estudiante_id: Number(estudianteId) },
      select: { uic_asignacion_id: true }
    });
    if (!asign) { const e=new Error('Estudiante no asignado a su tutoría'); e.status=404; throw e; }

    // obtener nota actual (si existe)
    const nota = await prisma.uic_tutor_notas.findUnique({
      where: { uic_asignacion_id_parcial: { uic_asignacion_id: Number(asign.uic_asignacion_id), parcial: parcialNum } },
      select: { nota: true }
    });

    // enviar notificación (no bloquear en caso de error)
    try {
      const notifications = require("../services/notificationsService");
      await notifications.create({
        id_user: Number(estudianteId),
        type: 'tutor_parcial_publicado',
        title: `Calificación Parcial ${parcialNum} publicada`,
        message: nota && nota.nota != null ? `Tu nota del parcial ${parcialNum} es ${Number(nota.nota)}` : `Se publicó tu parcial ${parcialNum}`,
        entity_type: 'uic_tutor_parcial',
        entity_id: Number(asign.uic_asignacion_id),
      });
    } catch (_) {}

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============== Docente Complexivo ===============

// GET /docente/complexivo/mis-materias
router.get('/complexivo/mis-materias', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    // período activo opcional (si existe, filtramos)
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    const where = { docente_usuario_id: Number(me), ...(Number.isFinite(Number(id_ap)) ? { periodo_id: Number(id_ap) } : {}) };
    const rows = await prisma.complexivo_materias.findMany({
      where,
      select: { complexivo_materia_id: true, nombre: true, codigo: true, periodo_id: true, carrera_id: true }
    });
    const periodos = await prisma.periodos.findMany({ where: { periodo_id: { in: rows.map(r=>r.periodo_id) } }, select: { periodo_id: true, nombre: true } });
    const periodName = new Map(periodos.map(p => [p.periodo_id, p.nombre]));

    // Mapear nombres de carrera desde Instituto
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(rows.map(r => Number(r.carrera_id)).filter(n => Number.isFinite(n) && n > 0)));
      if (careerIds.length) {
        const inList = careerIds.join(',');
        const list = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(list)) {
          for (const r of list) careerNameMap[Number(r.id)] = String(r.nombre);
        }
      }
    } catch (_) { careerNameMap = {}; }
    const data = [];
    for (const r of rows) {
      // contar estudiantes por modalidad (EXAMEN_COMPLEXIVO) y carrera en el período
      let estudiantesAsignados = 0;
      try {
        estudiantesAsignados = await prisma.modalidades_elegidas.count({
          where: {
            periodo_id: Number(r.periodo_id),
            modalidad: 'EXAMEN_COMPLEXIVO',
            ...(Number.isFinite(Number(r.carrera_id)) ? { carrera_id: Number(r.carrera_id) } : {}),
          }
        });
      } catch (_) { estudiantesAsignados = 0; }
      data.push({
        id: String(r.complexivo_materia_id),
        nombre: r.nombre,
        codigo: r.codigo,
        periodo: periodName.get(r.periodo_id) || '',
        carrera: careerNameMap[Number(r.carrera_id)] || null,
        estudiantesAsignados,
        publicado: true,
        asignadoADocente: true,
      });
    }
    res.json(data);
  } catch (err) { next(err); }
});

// GET /docente/complexivo/materias/:materiaId/estudiantes
router.get('/complexivo/materias/:materiaId/estudiantes', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const materiaId = Number(req.params.materiaId);
    if (!Number.isFinite(materiaId)) { const e=new Error('Parámetro inválido'); e.status=400; throw e; }
    const mat = await prisma.complexivo_materias.findUnique({ where: { complexivo_materia_id: materiaId }, select: { docente_usuario_id: true, carrera_id: true, periodo_id: true } });
    if (!mat || Number(mat.docente_usuario_id) !== Number(me)) { const e=new Error('No autorizado a esta materia'); e.status=403; throw e; }
    // estudiantes por modalidad EXAMEN_COMPLEXIVO y carrera en el período
    const mods = await prisma.modalidades_elegidas.findMany({
      where: {
        periodo_id: Number(mat.periodo_id),
        modalidad: 'EXAMEN_COMPLEXIVO',
        ...(Number.isFinite(Number(mat.carrera_id)) ? { carrera_id: Number(mat.carrera_id) } : {}),
      },
      select: { estudiante_id: true }
    });
    const estIds = Array.from(new Set(mods.map(m => Number(m.estudiante_id)).filter(n => Number.isFinite(n) && n > 0)));
    if (estIds.length === 0) return res.json([]);
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: estIds } }, select: { usuario_id: true, nombre: true, apellido: true } });
    const mapUser = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const data = estIds.map(id => ({ id: String(id), nombre: mapUser.get(id) || `Usuario ${id}` })).sort((a,b)=> String(a.nombre).localeCompare(String(b.nombre)));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /docente/complexivo/materias/:materiaId/asistencia/fechas -> lista de fechas con registros
router.get('/complexivo/materias/:materiaId/asistencia/fechas', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const materiaId = Number(req.params.materiaId);
    if (!Number.isFinite(materiaId)) { const e=new Error('Parámetro inválido'); e.status=400; throw e; }
    const mat = await prisma.complexivo_materias.findUnique({ where: { complexivo_materia_id: materiaId }, select: { docente_usuario_id: true } });
    if (!mat || Number(mat.docente_usuario_id) !== Number(me)) { const e=new Error('No autorizado a esta materia'); e.status=403; throw e; }
    const fechas = await prisma.$queryRaw`SELECT DISTINCT fecha FROM complexivo_asistencias WHERE materia_id = ${materiaId} ORDER BY fecha DESC`;
    const list = Array.isArray(fechas) ? fechas.map((r) => (r.fecha instanceof Date ? r.fecha.toISOString().slice(0,10) : String(r.fecha))).filter(Boolean) : [];
    res.json(list);
  } catch (err) { next(err); }
});

// GET /docente/complexivo/materias/:materiaId/asistencia?fecha=YYYY-MM-DD
router.get('/complexivo/materias/:materiaId/asistencia', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const materiaId = Number(req.params.materiaId);
    const fechaStr = String(req.query?.fecha || '');
    if (!Number.isFinite(materiaId) || !/\d{4}-\d{2}-\d{2}/.test(fechaStr)) { const e=new Error('Parámetros inválidos'); e.status=400; throw e; }
    const mat = await prisma.complexivo_materias.findUnique({ where: { complexivo_materia_id: materiaId }, select: { docente_usuario_id: true } });
    if (!mat || Number(mat.docente_usuario_id) !== Number(me)) { const e=new Error('No autorizado a esta materia'); e.status=403; throw e; }
    const fecha = new Date(fechaStr);
    const rows = await prisma.complexivo_asistencias.findMany({ where: { materia_id: materiaId, fecha }, select: { estudiante_id: true, estado: true } });
    // mapear nombres
    const estIds = Array.from(new Set(rows.map(r => r.estudiante_id)));
    const usuarios = estIds.length ? await prisma.usuarios.findMany({ where: { usuario_id: { in: estIds } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));
    const data = rows.map(r => ({ id: String(r.estudiante_id), nombre: nameMap.get(r.estudiante_id) || `Usuario ${r.estudiante_id}`, presente: String(r.estado) === 'presente' }));
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /docente/complexivo/materias/:materiaId/asistencia  Body: { fecha: 'YYYY-MM-DD', items: [{ id: string, presente: boolean }] }
router.put('/complexivo/materias/:materiaId/asistencia', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const materiaId = Number(req.params.materiaId);
    const { fecha, items } = req.body || {};
    if (!Number.isFinite(materiaId) || !fecha || !Array.isArray(items)) { const e=new Error('Parámetros inválidos'); e.status=400; throw e; }
    const mat = await prisma.complexivo_materias.findUnique({ where: { complexivo_materia_id: materiaId }, select: { docente_usuario_id: true } });
    if (!mat || Number(mat.docente_usuario_id) !== Number(me)) { const e=new Error('No autorizado a esta materia'); e.status=403; throw e; }
    const fechaDt = new Date(String(fecha));
    for (const it of items) {
      const estId = Number(it?.id);
      if (!Number.isFinite(estId)) continue;
      const estado = it?.presente ? 'presente' : 'ausente';
      // upsert por materia/estudiante/fecha (uq)
      const existing = await prisma.complexivo_asistencias.findFirst({ where: { materia_id: materiaId, estudiante_id: estId, fecha: fechaDt }, select: { complexivo_asistencia_id: true } });
      if (existing) {
        await prisma.complexivo_asistencias.update({ where: { complexivo_asistencia_id: existing.complexivo_asistencia_id }, data: { estado } });
      } else {
        await prisma.complexivo_asistencias.create({ data: { materia_id: materiaId, estudiante_id: estId, fecha: fechaDt, estado } });
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============== Docente Lector (UIC) ===============

// GET /docente/lector/estudiantes
// Lista estudiantes UIC donde soy lector en el período activo, con carrera y último documento uic_final
router.get('/lector/estudiantes', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    // período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    // asignaciones donde soy lector
    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap), lector_usuario_id: Number(me) },
      select: { estudiante_id: true, carrera_id: true, lector_nota: true, lector_observacion: true }
    });
    if (asigns.length === 0) return res.json([]);
    const estIds = Array.from(new Set(asigns.map(a => a.estudiante_id)));

    // nombres estudiantes
    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: estIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    // carrera desde uic_topics como fallback (texto)
    let topicCareerMap = {};
    try {
      const topics = await prisma.uic_topics.findMany({
        where: { id_academic_periods: Number(id_ap), id_user: { in: estIds } },
        select: { id_user: true, career: true }
      });
      if (Array.isArray(topics)) {
        for (const t of topics) {
          const uid = Number(t.id_user);
          if (!Number.isFinite(uid)) continue;
          topicCareerMap[uid] = t.career != null ? String(t.career) : null;
        }
      }
    } catch (_) { topicCareerMap = {}; }

    // carreras names from external schema
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const careerIds = Array.from(new Set(asigns.map(a => a.carrera_id).filter(x=>Number.isFinite(Number(x)))));
      if (careerIds.length > 0) {
        const inList = careerIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) {
          for (const r of rows) { careerNameMap[Number(r.id)] = String(r.nombre); }
        }
      }
    } catch (_) { careerNameMap = {}; }

    // último documento uic_final por estudiante
    const data = [];
    for (const a of asigns) {
      let docUrl = null;
      let documentoId = null;
      try {
        const doc = await prisma.documentos.findFirst({
          where: {
            tipo: 'uic_final',
            OR: [
              { estudiante_id: Number(a.estudiante_id) },
              { usuario_id: Number(a.estudiante_id) },
            ]
          },
          orderBy: { creado_en: 'desc' },
          select: { documento_id: true, ruta_archivo: true }
        });
        docUrl = doc?.ruta_archivo || null;
        documentoId = doc?.documento_id != null ? Number(doc.documento_id) : null;
      } catch (_) {}
      data.push({
        id: String(a.estudiante_id),
        nombre: nameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
        carrera: careerNameMap[a.carrera_id] || topicCareerMap[Number(a.estudiante_id)] || null,
        documentoUrl: docUrl,
        documentoId,
        calificacion: a.lector_nota != null ? Number(a.lector_nota) : null,
        observacion: a.lector_observacion || ''
      });
    }
    // ordenar alfabéticamente
    data.sort((x,y)=> String(x.nombre).localeCompare(String(y.nombre)));
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /docente/lector/estudiantes/:estudianteId/review
// Body: { calificacion: number|null, observacion?: string }
router.put('/lector/estudiantes/:estudianteId/review', authorize('Docente','Administrador','Coordinador'), async (req, res, next) => {
  try {
    const me = getEffectiveDocenteId(req);
    if (!Number.isFinite(Number(me))) { const e=new Error('No autorizado'); e.status=401; throw e; }
    const estudianteId = Number(req.params.estudianteId);
    if (!Number.isFinite(estudianteId)) { const e=new Error('Parámetro inválido'); e.status=400; throw e; }
    const { calificacion, observacion } = req.body || {};

    // normalizar calificación 0..10 con 1 decimal, o null
    let cal = null;
    if (calificacion !== null && calificacion !== undefined) {
      const n = Number(calificacion);
      if (!Number.isNaN(n)) {
        cal = Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
      }
    }
    const obs = typeof observacion === 'string' ? observacion.slice(0, 500) : undefined;

    // período activo
    let id_ap = undefined;
    try {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    } catch (_) {}
    if (!Number.isFinite(Number(id_ap))) { const e=new Error('No hay período activo'); e.status=400; throw e; }

    const roles = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : (req.user?.role ? [String(req.user.role)] : []);
    const isAdmin = roles.includes('Administrador') || roles.includes('Admin') || roles.includes('ADMIN');

    // verificar que soy lector asignado del estudiante
    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), lector_usuario_id: Number(me), estudiante_id: Number(estudianteId) },
      select: { uic_asignacion_id: true, lector_nota: true, lector_observacion: true }
    });
    if (!asign) { const e=new Error('Estudiante no asignado a su lectura'); e.status=404; throw e; }

    const alreadyReviewed = asign.lector_nota != null || (typeof asign.lector_observacion === 'string' && asign.lector_observacion.trim().length > 0);
    if (alreadyReviewed && !isAdmin) {
      const e = new Error('La calificación ya fue registrada. Solo el Administrador puede editarla.');
      e.status = 403;
      throw e;
    }

    // actualizar valores en la asignación
    await prisma.uic_asignaciones.update({
      where: { uic_asignacion_id: Number(asign.uic_asignacion_id) },
      data: { lector_nota: cal, ...(obs !== undefined ? { lector_observacion: obs } : {}) }
    });

    // enviar notificación (no bloquear en caso de error)
    try {
      const notifications = require("../services/notificationsService");
      await notifications.create({
        id_user: Number(estudianteId),
        type: 'uic_lector_review',
        title: 'Revisión del Lector registrada',
        message: cal != null ? `Tu revisión del Lector fue registrada. Nota: ${cal}` : 'Tu revisión del Lector fue registrada/actualizada.',
        entity_type: 'uic_lector_review',
        entity_id: Number(asign.uic_asignacion_id),
      });
    } catch (_) {}

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
