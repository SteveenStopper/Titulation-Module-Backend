const { z } = require("zod");
const prisma = require("../../prisma/client");
const secretariaService = require("../services/secretariaService");
const viewsDao = require("../daos/viewsDao");
let settingsService;
try {
  settingsService = require("../services/settingsService");
} catch (_) {
  settingsService = require("./settingsService");
}

async function generarCertNotas(req, res, next) {
  try {
    const schema = z.object({
      userId: z.coerce.number().int(),
      academicPeriodId: z.coerce.number().int().optional(),
    });
    const { userId, academicPeriodId } = schema.parse(req.body || {});
    const issuerId = req.user?.sub;
    const result = await secretariaService.generateNotasCertificate({ studentId: userId, academicPeriodId, issuerId });
    // Notificar al estudiante que se generó su certificado de notas
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({
        id_user: Number(userId),
        type: 'notas_publicadas',
        title: 'Notas publicadas',
        message: 'Se generó tu certificado de notas',
        entity_type: 'cert_notas',
        entity_id: Number(result?.id || 0),
      });
    } catch (_) { /* no bloquear */ }
    res.status(201).json(result);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400; err.message = err.errors.map(e => e.message).join(", ");
    }
    next(err);
  }
}

module.exports.generarCertNotas = generarCertNotas;

async function listPromedios(req, res, next) {
  try {
    const schema = z.object({ page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().optional() });
    const { page = 1, pageSize = 20 } = schema.parse(req.query || {});
    const offset = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(pageSize));
    const limit = Math.max(1, Number(pageSize));

    // Período local activo (para validaciones persistentes)
    const active = await settingsService.getActivePeriod();
    const id_local_periodo = Number(active?.id_academic_periods);
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    if (!Number.isFinite(Number(id_local_periodo))) return res.json({ data: [], pagination: { page: Number(page), pageSize: limit } });

    // Período externo asociado al período local activo (sin fallback)
    let id_ext_periodo = null;
    try {
      const rows = await prisma.$queryRawUnsafe(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
        `external_period_for_${Number(id_local_periodo)}`
      );
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      const rawVal = row ? row.setting_value : null;
      const val = rawVal ? (typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal) : null;
      const extId = Number(val?.external_period_id);
      if (Number.isFinite(extId)) id_ext_periodo = extId;
    } catch (_) {
      // ignorar
    }
    if (!Number.isFinite(Number(id_ext_periodo))) return res.json({ data: [], pagination: { page: Number(page), pageSize: limit } });

    // Estudiantes con TODO aprobado (según regla por carrera) en el período mapeado
    const base = await viewsDao.getNotasResumenAprobadosByPeriodo({ external_period_id: Number(id_ext_periodo), offset, limit });
    const idsPage = (base || []).map(r => Number(r.estudiante_id)).filter(Number.isFinite);
    if (!idsPage.length) return res.json({ data: [], pagination: { page: Number(page), pageSize: limit } });

    // Estado de Secretaría (validación) en el último período local
    const secVals = await prisma.procesos_validaciones.findMany({
      where: { proceso: 'secretaria_promedios', periodo_id: Number(id_local_periodo), estudiante_id: { in: idsPage } },
      select: { estudiante_id: true, estado: true, certificado_doc_id: true }
    });
    const normalizeEstado = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'approved') return 'aprobado';
      if (v === 'rejected') return 'rechazado';
      return 'pendiente';
    };
    const normDocId = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const secMap = new Map((secVals || []).map(v => [Number(v.estudiante_id), { estado: normalizeEstado(v.estado), certificado_doc_id: normDocId(v.certificado_doc_id) }]));

    const toNumOrNull = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const rows = (base || []).map(r => ({
      estudiante_id: Number(r.estudiante_id),
      nombre: String(r.nombre || '').trim(),
      carrera: String(r.carrera || '').trim(),
      s1: toNumOrNull(r.s1),
      s2: toNumOrNull(r.s2),
      s3: toNumOrNull(r.s3),
      s4: toNumOrNull(r.s4),
      s5: toNumOrNull(r.s5),
      promedio_general: toNumOrNull(r.promedio_general),
      estado: (secMap.get(Number(r.estudiante_id))?.estado) || 'pendiente',
      certificado_doc_id: (secMap.get(Number(r.estudiante_id))?.certificado_doc_id) ?? null,
    }));

    res.json({ data: rows, pagination: { page: Number(page), pageSize: limit } });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function getPromediosById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { const e = new Error('ID inválido'); e.status = 400; throw e; }

    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';

    // Período local activo
    const active = await settingsService.getActivePeriod();
    const id_local_periodo = Number(active?.id_academic_periods);
    if (!Number.isFinite(Number(id_local_periodo))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }

    // Período externo asociado al período local activo
    let id_ext_periodo = null;
    try {
      const rows = await prisma.$queryRawUnsafe(
        'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
        `external_period_for_${Number(id_local_periodo)}`
      );
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      const rawVal = row ? row.setting_value : null;
      const val = rawVal ? (typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal) : null;
      const extId = Number(val?.external_period_id);
      if (Number.isFinite(extId)) id_ext_periodo = extId;
    } catch (_) {
      // ignorar
    }

    if (!Number.isFinite(Number(id_ext_periodo))) { const e = new Error('No hay período asociado al active_period'); e.status = 400; throw e; }

    const base = await viewsDao.getNotasResumenAprobadosByPeriodoById({ external_period_id: Number(id_ext_periodo), estudiante_id: Number(id) });
    if (!base) { const e = new Error('Estudiante no cumple requisitos de aprobación en el período activo'); e.status = 404; throw e; }

    const normalizeEstado = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'approved') return 'aprobado';
      if (v === 'rejected') return 'rechazado';
      return 'pendiente';
    };
    const secVal = await prisma.procesos_validaciones.findFirst({
      where: { proceso: 'secretaria_promedios', periodo_id: Number(id_local_periodo), estudiante_id: Number(id) },
      select: { estado: true, certificado_doc_id: true }
    });
    const normDocId = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const toNumOrNull = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    res.json({
      estudiante_id: Number(base.estudiante_id),
      nombre: String(base.nombre || '').trim(),
      carrera: String(base.carrera || '').trim(),
      s1: toNumOrNull(base.s1),
      s2: toNumOrNull(base.s2),
      s3: toNumOrNull(base.s3),
      s4: toNumOrNull(base.s4),
      s5: toNumOrNull(base.s5),
      promedio_general: toNumOrNull(base.promedio_general),
      estado: normalizeEstado(secVal?.estado),
      certificado_doc_id: normDocId(secVal?.certificado_doc_id),
    });
  } catch (err) { next(err); }
}

module.exports.listPromedios = listPromedios;
module.exports.getPromediosById = getPromediosById;

async function getNotasDetalle(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { const e = new Error('ID inválido'); e.status = 400; throw e; }
    const row = await viewsDao.getNotasEstudiante(id);
    if (!row) { const e = new Error('Estudiante no encontrado'); e.status = 404; throw e; }
    res.json(row);
  } catch (err) { next(err); }
}

module.exports.getNotasDetalle = getNotasDetalle;

async function approve(req, res, next) {
  try {
    const schema = z.object({ periodo_id: z.coerce.number().int().optional(), estudiante_id: z.coerce.number().int() });
    const { periodo_id, estudiante_id } = schema.parse(req.body || {});
    const updated = await secretariaService.aprobar({ periodo_id, estudiante_id });
    // Notificar al estudiante que su validación fue aprobada
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({
        id_user: Number(estudiante_id),
        type: 'secretaria_aprobado',
        title: 'Secretaría: Validación aprobada',
        message: 'Tu validación de promedios fue aprobada',
        entity_type: 'validacion',
        entity_id: Number(updated?.proceso_validacion_id || 0),
      });
    } catch (_) { /* no bloquear */ }
    res.json(updated);
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function reject(req, res, next) {
  try {
    const schema = z.object({ periodo_id: z.coerce.number().int().optional(), estudiante_id: z.coerce.number().int(), observacion: z.string().optional() });
    const { periodo_id, estudiante_id, observacion } = schema.parse(req.body || {});
    const updated = await secretariaService.rechazar({ periodo_id, estudiante_id, observacion });
    // Notificar al estudiante que su validación fue rechazada
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({
        id_user: Number(estudiante_id),
        type: 'secretaria_rechazo',
        title: 'Secretaría: Validación rechazada',
        message: observacion || 'Tu validación de promedios fue rechazada',
        entity_type: 'validacion',
        entity_id: Number(updated?.proceso_validacion_id || 0),
      });
    } catch (_) { /* no bloquear */ }
    res.json(updated);
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

module.exports.approve = approve;
module.exports.reject = reject;

async function reconsider(req, res, next) {
  try {
    const schema = z.object({ periodo_id: z.coerce.number().int().optional(), estudiante_id: z.coerce.number().int() });
    const { periodo_id, estudiante_id } = schema.parse(req.body || {});
    const updated = await secretariaService.reconsiderar({ periodo_id, estudiante_id });
    res.json(updated);
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

module.exports.reconsider = reconsider;

async function actaLista(req, res, next) {
  try {
    const idActa = Number(req.params.id);
    if (!Number.isFinite(idActa)) { const e = new Error('ID inválido'); e.status = 400; throw e; }
    const schema = z.object({ id_user_student: z.coerce.number().int() });
    const { id_user_student } = schema.parse(req.body || {});
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({
        id_user: Number(id_user_student),
        type: 'acta_lista',
        title: 'Acta de grado lista',
        message: 'Tu acta de grado está lista para revisión',
        entity_type: 'acta_grado',
        entity_id: idActa,
      });
      await notifications.notifyRoles({
        roles: ['Secretaria'],
        type: 'acta_lista',
        title: 'Acta lista',
        message: `Acta ${idActa} marcada como lista`,
        entity_type: 'acta_grado',
        entity_id: idActa,
      });
    } catch (_) { /* no bloquear */ }
    res.json({ ok: true });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function actaFirmada(req, res, next) {
  try {
    const idActa = Number(req.params.id);
    if (!Number.isFinite(idActa)) { const e = new Error('ID inválido'); e.status = 400; throw e; }
    const schema = z.object({ id_user_student: z.coerce.number().int(), documento_id: z.coerce.number().int().optional() });
    const { id_user_student, documento_id } = schema.parse(req.body || {});
    // Si viene documento_id, persistir en uic_asignaciones.acta_doc_id del período activo
    if (Number.isFinite(Number(documento_id))) {
      try {
        const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
        const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
        const id_ap = per?.id_academic_periods;
        if (Number.isFinite(Number(id_ap))) {
          await prisma.uic_asignaciones.update({
            where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
            data: { acta_doc_id: Number(documento_id) },
          });
        }
      } catch (_) { /* no bloquear persistencia de acta */ }
    }
    try {
      const notifications = require('../services/notificationsService');
      await notifications.create({
        id_user: Number(id_user_student),
        type: 'acta_firmada',
        title: 'Acta de grado firmada',
        message: 'Tu acta de grado ha sido firmada',
        entity_type: 'acta_grado',
        entity_id: idActa,
      });
      await notifications.notifyRoles({
        roles: ['Secretaria'],
        type: 'acta_firmada',
        title: 'Acta firmada',
        message: `Acta ${idActa} marcada como firmada`,
        entity_type: 'acta_grado',
        entity_id: idActa,
      });
    } catch (_) { /* no bloquear */ }
    res.json({ ok: true });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

module.exports.actaLista = actaLista;
module.exports.actaFirmada = actaFirmada;

// ============== Acta de Grado: listado, guardar nota, generar hoja, vincular documento ==============

async function listActas(req, res, next) {
  try {
    // período activo
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const asigns = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap) },
      select: { estudiante_id: true, carrera_id: true, nota_tribunal: true, acta_doc_id: true }
    });
    if (asigns.length === 0) return res.json([]);
    const estIds = Array.from(new Set(asigns.map(a => a.estudiante_id)));
    const usuarios = await prisma.usuarios.findMany({ where: { usuario_id: { in: estIds } }, select: { usuario_id: true, nombre: true, apellido: true } });
    const nameMap = new Map(usuarios.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    // Tribunal (concatenar nombres)
    const tribMiembros = await prisma.uic_tribunal_miembros.findMany({
      where: { uic_asignaciones: { periodo_id: Number(id_ap) } },
      select: { uic_asignacion_id: true, docente_usuario_id: true }
    });
    const docIds = Array.from(new Set(tribMiembros.map(m => m.docente_usuario_id)));
    const docs = docIds.length ? await prisma.usuarios.findMany({ where: { usuario_id: { in: docIds } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const docName = new Map(docs.map(d => [d.usuario_id, `${d.nombre} ${d.apellido}`.trim()]));

    // Map carrera desde esquema externo
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const carIds = Array.from(new Set(asigns.map(a => a.carrera_id)));
      if (carIds.length) {
        const inList = carIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }

    // Necesitamos map asignacion_id para miembros; obtener ids
    const asigRows = await prisma.uic_asignaciones.findMany({
      where: { periodo_id: Number(id_ap) },
      select: { uic_asignacion_id: true, estudiante_id: true }
    });
    const asigByEst = new Map(asigRows.map(r => [r.estudiante_id, r.uic_asignacion_id]));

    const data = asigns.map(a => {
      const asigId = asigByEst.get(a.estudiante_id);
      const miembros = tribMiembros.filter(m => m.uic_asignacion_id === asigId).map(m => docName.get(m.docente_usuario_id)).filter(Boolean);
      return {
        id: Number(a.estudiante_id),
        estudiante: nameMap.get(a.estudiante_id) || `Usuario ${a.estudiante_id}`,
        carrera: careerNameMap[a.carrera_id] || null,
        tribunal: miembros.join(', '),
        calificacionTribunal: a.nota_tribunal != null ? Number(a.nota_tribunal) : null,
        hojaCargada: Number.isFinite(Number(a.acta_doc_id))
      };
    }).sort((x, y) => String(x.estudiante).localeCompare(String(y.estudiante)));

    res.json(data);
  } catch (err) { next(err); }
}

async function saveNotaTribunal(req, res, next) {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), score: z.coerce.number().min(0).max(10) });
    const { id_user_student, score } = schema.parse(req.body || {});
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }
    await prisma.uic_asignaciones.update({
      where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
      data: { nota_tribunal: Number(score) }
    });
    res.json({ ok: true });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function generateHoja(req, res, next) {
  try {
    let PDFDocument; try { PDFDocument = require('pdfkit'); } catch (_) { const err = new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit'); err.status = 501; throw err; }
    const schema = z.object({ id_user_student: z.coerce.number().int() });
    const { id_user_student } = schema.parse(req.body || {});
    // Datos básicos del estudiante (nombre) y tribunal
    const u = await prisma.usuarios.findUnique({ where: { usuario_id: Number(id_user_student) }, select: { nombre: true, apellido: true } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="hoja-tribunal.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(18).text('Hoja de Tribunal - Acta de Grado', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Estudiante: ${u ? `${u.nombre} ${u.apellido}`.trim() : id_user_student}`);
    doc.text('Calificación del tribunal: ________');
    doc.text('Miembros del tribunal:');
    doc.text('- __________________________');
    doc.text('- __________________________');
    doc.text('- __________________________');
    doc.end();
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function linkHoja(req, res, next) {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), documento_id: z.coerce.number().int() });
    const { id_user_student, documento_id } = schema.parse(req.body || {});
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }
    await prisma.uic_asignaciones.update({
      where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
      data: { acta_doc_id: Number(documento_id) }
    });
    res.json({ ok: true });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

module.exports.listActas = listActas;
module.exports.saveNotaTribunal = saveNotaTribunal;
module.exports.generateHoja = generateHoja;
module.exports.linkHoja = linkHoja;

// ============== Acta de Grado (Examen Complexivo) ==============

async function listActasComplexivo(req, res, next) {
  try {
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const mods = await prisma.modalidades_elegidas.findMany({
      where: { periodo_id: Number(id_ap), modalidad: 'EXAMEN_COMPLEXIVO' },
      select: { estudiante_id: true, carrera_id: true }
    }).catch(() => []);
    if (!mods.length) return res.json([]);

    const estIds = Array.from(new Set(mods.map(m => Number(m.estudiante_id)).filter(Number.isFinite)));
    if (!estIds.length) return res.json([]);

    const usuarios = await prisma.usuarios.findMany({
      where: { usuario_id: { in: estIds } },
      select: { usuario_id: true, nombre: true, apellido: true }
    }).catch(() => []);
    const nameMap = new Map((usuarios || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));

    // Nota complexivo en academic_grades
    const grades = await prisma.academic_grades.findMany({
      where: { module: 'complexivo', id_academic_periods: Number(id_ap), id_user: { in: estIds } },
      select: { id_user: true, score: true }
    }).catch(() => []);
    const gradeMap = new Map((grades || []).map(g => [Number(g.id_user), g.score != null ? Number(g.score) : null]));

    // Map carrera desde esquema externo
    let careerNameMap = {};
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const carIds = Array.from(new Set(mods.map(m => Number(m.carrera_id)).filter(Number.isFinite)));
      if (carIds.length) {
        const inList = carIds.join(',');
        const rows = await prisma.$queryRawUnsafe(`SELECT ID_CARRERAS AS id, NOMBRE_CARRERAS AS nombre FROM ${EXT_SCHEMA}.MATRICULACION_CARRERAS WHERE ID_CARRERAS IN (${inList})`);
        if (Array.isArray(rows)) for (const r of rows) careerNameMap[Number(r.id)] = String(r.nombre);
      }
    } catch (_) { careerNameMap = {}; }

    const data = mods
      .map(m => ({
        id: Number(m.estudiante_id),
        estudiante: nameMap.get(Number(m.estudiante_id)) || `Usuario ${m.estudiante_id}`,
        carrera: careerNameMap[Number(m.carrera_id)] || null,
        calificacionComplexivo: gradeMap.has(Number(m.estudiante_id)) ? gradeMap.get(Number(m.estudiante_id)) : null,
      }))
      .sort((a, b) => String(a.estudiante).localeCompare(String(b.estudiante)));

    res.json(data);
  } catch (err) { next(err); }
}

async function saveNotaComplexivo(req, res, next) {
  try {
    const schema = z.object({ id_user_student: z.coerce.number().int(), score: z.coerce.number().min(0).max(10) });
    const { id_user_student, score } = schema.parse(req.body || {});
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id_ap = per?.id_academic_periods;
    if (!Number.isFinite(Number(id_ap))) { const e = new Error('No hay período activo'); e.status = 400; throw e; }

    await prisma.academic_grades.upsert({
      where: { module_id_user_id_academic_periods: { module: 'complexivo', id_user: Number(id_user_student), id_academic_periods: Number(id_ap) } },
      update: { score: Number(score), status: 'saved' },
      create: { module: 'complexivo', id_user: Number(id_user_student), id_academic_periods: Number(id_ap), score: Number(score), status: 'saved' },
      select: { grade_id: true }
    });

    res.json({ ok: true });
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

async function generateActaComplexivo(req, res, next) {
  try {
    let PDFDocument; try { PDFDocument = require('pdfkit'); } catch (_) { const err = new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit'); err.status = 501; throw err; }
    const schema = z.object({ id_user_student: z.coerce.number().int() });
    const { id_user_student } = schema.parse(req.body || {});

    const u = await prisma.usuarios.findUnique({ where: { usuario_id: Number(id_user_student) }, select: { nombre: true, apellido: true } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="acta-complexivo.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(18).text('Acta de Grado - Examen Complexivo', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Estudiante: ${u ? `${u.nombre} ${u.apellido}`.trim() : id_user_student}`);
    doc.text('Calificación Examen Complexivo: ________');
    doc.end();
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); } next(err); }
}

module.exports.listActasComplexivo = listActasComplexivo;
module.exports.saveNotaComplexivo = saveNotaComplexivo;
module.exports.generateActaComplexivo = generateActaComplexivo;
