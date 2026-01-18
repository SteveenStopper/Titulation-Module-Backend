const fs = require("fs");
const path = require("path");
const prisma = require("../../prisma/client");
const viewsDao = require("../daos/viewsDao");
const PASSING = Number(process.env.MIN_APROBADO || 7);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function getActiveLocalPeriodId() {
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      'active_period'
    );
    const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (setting && setting.setting_value) {
      const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
      const id = Number(val?.id_academic_periods);
      if (Number.isFinite(id)) return id;
    }
  } catch (_) {
    // ignore
  }
  try {
    const per = await prisma.periodos.findFirst({ where: { estado: 'activo' }, orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
    return per?.periodo_id ?? null;
  } catch (_) {
    return null;
  }
}

async function getExternalPeriodIdForLocalPeriod(periodo_id) {
  try {
    const key = `external_period_for_${Number(periodo_id)}`;
    const rows = await prisma.$queryRawUnsafe(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      key
    );
    const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!setting || !setting.setting_value) return null;
    const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
    const extId = Number(val?.external_period_id);
    return Number.isFinite(extId) ? extId : null;
  } catch (_) {
    return null;
  }
}

async function listExternalStudentsForPeriod({ external_period_id, offset, limit }) {
  const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
  const sql = `
    SELECT
      u.ID_USUARIOS AS estudiante_id,
      u.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(u.NOMBRES_USUARIOS, ' ', u.APELLIDOS_USUARIOS) AS nombre,
      u.ID_CARRERA AS carrera_id,
      c.NOMBRE_CARRERAS AS carrera_nombre
    FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON u.DOCUMENTO_USUARIOS = me.DOCUMENTO_ESTUDIANTES
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = u.ID_CARRERA
    WHERE me.ID_PERIODO_ESTUDIANTES = ?
      AND (u.STATUS_USUARIOS='ACTIVO' OR u.STATUS_USUARIOS IS NULL)
    ORDER BY nombre ASC
    LIMIT ?, ?
  `;
  return prisma.$queryRawUnsafe(sql, Number(external_period_id), Number(offset), Number(limit));
}

async function listResumen({ page = 1, pageSize = 20, minSem = null }) {
  const _page = Math.max(1, Number(page) || 1);
  const _pageSize = Math.max(1, Number(pageSize) || 20);
  const offset = (_page - 1) * _pageSize;
  const limit = _pageSize;
  const localPeriod = await prisma.periodos.findFirst({ orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
  const localPeriodId = localPeriod?.periodo_id;
  if (!Number.isFinite(Number(localPeriodId))) {
    return { data: [], pagination: { page: _page, pageSize: _pageSize } };
  }

  const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
  const extPerRows = await prisma.$queryRawUnsafe(
    `SELECT ID_PERIODO AS id FROM ${EXT_SCHEMA}.MATRICULACION_PERIODO ORDER BY ID_PERIODO DESC LIMIT 1`
  );
  const extPerRow = Array.isArray(extPerRows) && extPerRows[0] ? extPerRows[0] : null;
  const externalPeriodId = extPerRow ? Number(extPerRow.id) : null;
  if (!Number.isFinite(Number(externalPeriodId))) {
    return { data: [], pagination: { page: _page, pageSize: _pageSize } };
  }

  let rows = await listExternalStudentsForPeriod({ external_period_id: externalPeriodId, offset, limit });

  // Adjuntar estado de validación (persistente) desde la BD local
  const ids = (rows || []).map(r => Number(r.estudiante_id)).filter(Number.isFinite);
  const validations = ids.length
    ? await prisma.procesos_validaciones.findMany({
      where: { proceso: 'tesoreria_aranceles', periodo_id: Number(localPeriodId), estudiante_id: { in: ids } },
      select: { estudiante_id: true, estado: true, observacion: true, certificado_doc_id: true }
    })
    : [];
  const vMap = new Map((validations || []).map(v => [Number(v.estudiante_id), v]));
  rows = (rows || []).map(r => {
    const v = vMap.get(Number(r.estudiante_id));
    return {
      ...r,
      validacion_estado: v?.estado || 'pending',
      validacion_observacion: v?.observacion || null,
      certificado_doc_id: v?.certificado_doc_id || null,
      periodo_id: Number(localPeriodId),
    };
  });

  // si se solicita minSem>=4, filtrar estrictamente a quienes tienen s1..s4 aprobados
  if (minSem !== null && Number(minSem) >= 4) {
    const checked = await Promise.all((rows || []).map(async (r) => {
      try {
        const notas = await viewsDao.getNotasEstudiante(r.estudiante_id);
        if (!notas) return null;
        const s1 = Number(notas.s1); const s2 = Number(notas.s2); const s3 = Number(notas.s3); const s4 = Number(notas.s4);
        const ok = [s1, s2, s3, s4].every(v => Number.isFinite(v) && v >= PASSING);
        return ok ? r : null;
      } catch (_) {
        return null;
      }
    }));
    rows = checked.filter(Boolean);
  }

  return { data: rows, pagination: { page: _page, pageSize: _pageSize } };
}

async function getEstadoFinanciero(estudianteId) {
  const rows = await viewsDao.getEstadoFinanciero(Number(estudianteId));
  return Array.isArray(rows) && rows[0] ? rows[0].estado_aranceles : "Inactivo";
}

async function setValidacionAranceles({ periodo_id, estudiante_id, estado, observacion = null, certificado_doc_id = null }) {
  const proceso = 'tesoreria_aranceles';
  return prisma.procesos_validaciones.upsert({
    where: { proceso_periodo_id_estudiante_id: { proceso, periodo_id, estudiante_id } },
    update: { estado, observacion, certificado_doc_id },
    create: { proceso, periodo_id, estudiante_id, estado, observacion, certificado_doc_id },
    select: { proceso_validacion_id: true, estado: true, certificado_doc_id: true }
  });
}

async function aprobar({ periodo_id, estudiante_id }) {
  const estado = await getEstadoFinanciero(estudiante_id);
  if (estado !== 'Activo') {
    const err = new Error('El estudiante aún presenta deudas en el instituto');
    err.status = 409; throw err;
  }
  return setValidacionAranceles({ periodo_id, estudiante_id, estado: 'approved' });
}

async function rechazar({ periodo_id, estudiante_id, observacion }) {
  return setValidacionAranceles({ periodo_id, estudiante_id, estado: 'rejected', observacion: observacion ?? null });
}

async function reconsiderar({ periodo_id, estudiante_id }) {
  const pv = await prisma.procesos_validaciones.findUnique({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'tesoreria_aranceles', periodo_id, estudiante_id } },
    select: { estado: true, certificado_doc_id: true }
  });
  if (!pv || pv.estado !== 'rejected') {
    const e = new Error('Solo se puede reconsiderar cuando está rechazado');
    e.status = 409;
    throw e;
  }
  if (pv.certificado_doc_id) {
    const e = new Error('No se puede reconsiderar con certificado generado');
    e.status = 409;
    throw e;
  }
  return setValidacionAranceles({ periodo_id, estudiante_id, estado: 'pending', observacion: null, certificado_doc_id: null });
}

async function generarCertificado({ periodo_id, estudiante_id, issuer_id }) {
  const v = await prisma.procesos_validaciones.findUnique({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'tesoreria_aranceles', periodo_id, estudiante_id } },
    select: { estado: true, certificado_doc_id: true }
  });
  if (!v || v.estado !== 'approved') { const e=new Error('Validación no aprobada'); e.status=409; throw e; }
  if (v.certificado_doc_id) { const e=new Error('Ya tiene certificado generado'); e.status=409; throw e; }

  const uploadsDir = path.join(process.cwd(), 'uploads', 'certificados', 'tesoreria', String(estudiante_id));
  ensureDir(uploadsDir);
  const filename = `cert_tesoreria_${estudiante_id}_${Date.now()}.pdf`;
  const abs = path.join(uploadsDir, filename);
  fs.writeFileSync(abs, Buffer.from('%PDF-1.4\n% DUMMY TESORERIA CERT\n'));
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');

  const doc = await prisma.documentos.create({
    data: {
      tipo: 'cert_tesoreria',
      ruta_archivo: rel,
      nombre_archivo: filename,
      mime_type: 'application/pdf',
      usuario_id: issuer_id,
      estudiante_id: estudiante_id,
    },
    select: { documento_id: true }
  });

  await setValidacionAranceles({ periodo_id, estudiante_id, estado: 'approved', certificado_doc_id: doc.documento_id });
  return { certificado_doc_id: doc.documento_id, ruta: rel };
}

async function ensureCertificado({ periodo_id, estudiante_id, issuer_id }) {
  // Busca validación y genera certificado si está aprobado y falta documento.
  const pv = await prisma.procesos_validaciones.findUnique({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'tesoreria_aranceles', periodo_id, estudiante_id } },
    select: { estado: true, certificado_doc_id: true }
  });
  if (pv && pv.certificado_doc_id) return pv.certificado_doc_id;

  // Si no existe validación o no está aprobada, validar contra vistas
  const estado = await getEstadoFinanciero(estudiante_id);
  if (estado !== 'Activo') {
    const e = new Error('El estudiante no está al día en Tesorería');
    e.status = 409; throw e;
  }
  // Aprobamos y generamos certificado si falta
  await setValidacionAranceles({ periodo_id, estudiante_id, estado: 'approved' });
  const created = await generarCertificado({ periodo_id, estudiante_id, issuer_id });
  return created.certificado_doc_id;
}

module.exports = { listResumen, aprobar, rechazar, reconsiderar, generarCertificado, ensureCertificado };
