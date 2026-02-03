const fs = require("fs");
const path = require("path");
const prisma = require("../../prisma/client");
const viewsDao = require("../daos/viewsDao");
const settingsService = require("./settingsService");
const usersService = require("./usersService");
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
      COALESCE(
        NULLIF(me.ID_CARRERAS_ESTUDIANTES, 0),
        NULLIF(me.ID_CARRERA_ESTUDIANTES, 0),
        mf.carrera_id
      ) AS carrera_id,
      c.NOMBRE_CARRERAS AS carrera_nombre
    FROM ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
    JOIN ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
      ON me.ID_ESTUDIANTES = mm.ID_ESTUDIANTE_MATRICULA
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON REPLACE(REPLACE(u.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
    LEFT JOIN (
      SELECT
        mm.ID_ESTUDIANTE_MATRICULA AS estudiante_id,
        MIN(fc.ID_CARRERA_FORMAR_CURSOS) AS carrera_id
      FROM ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
      JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc
        ON fc.ID_FORMAR_CURSOS = mm.ID_FORMAR_CURSOS_MATRICULA
      WHERE mm.ID_PERIODO_MATRICULA = ?
      GROUP BY mm.ID_ESTUDIANTE_MATRICULA
    ) mf ON mf.estudiante_id = me.ID_ESTUDIANTES
    LEFT JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = COALESCE(
        NULLIF(me.ID_CARRERAS_ESTUDIANTES, 0),
        NULLIF(me.ID_CARRERA_ESTUDIANTES, 0),
        mf.carrera_id
      )
    WHERE mm.ID_PERIODO_MATRICULA = ?
      AND (u.STATUS_USUARIOS='ACTIVO' OR u.STATUS_USUARIOS IS NULL)
    ORDER BY nombre ASC
    LIMIT ?, ?
  `;
  return prisma.$queryRawUnsafe(sql, Number(external_period_id), Number(external_period_id), Number(offset), Number(limit));
}

async function listResumen({ page = 1, pageSize = 20, minSem = null }) {
  const _page = Math.max(1, Number(page) || 1);
  const _pageSize = Math.max(1, Number(pageSize) || 20);
  const offset = (_page - 1) * _pageSize;
  const limit = _pageSize;

  // Usar período activo (app_settings.active_period) para mantener consistencia con el FE
  const active = await settingsService.getActivePeriod();
  const localPeriodId = Number(active?.id_academic_periods);
  if (!Number.isFinite(localPeriodId)) {
    return { data: [], pagination: { page: _page, pageSize: _pageSize } };
  }

  // Intentar usar el período externo asociado al período local activo
  const externalPeriodId = await getExternalPeriodIdForLocalPeriod(localPeriodId);
  try { console.log('[tesoreria] period map:', { localPeriodId, externalPeriodId }); } catch (_) { }
  if (!Number.isFinite(Number(externalPeriodId))) {
    return { data: [], pagination: { page: _page, pageSize: _pageSize } };
  }

  // Lista base: SOLO estudiantes aprobados (misma regla que Secretaría) con paginación SQL.
  // Evita páginas vacías cuando se pagina primero y se filtra después.
  let rows = await viewsDao.getNotasResumenAprobadosByPeriodo({
    external_period_id: Number(externalPeriodId),
    offset,
    limit
  });
  rows = (rows || []).map(r => ({
    estudiante_id: Number(r.estudiante_id),
    cedula: r.cedula,
    nombre: r.nombre,
    carrera_id: Number(r.carrera_id),
    carrera_nombre: r.carrera,
  }));

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

  // Si se solicita minSem>=4, filtrar estrictamente a quienes tienen s1..s4 aprobados
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
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (_) {
    const err = new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit');
    err.status = 501;
    throw err;
  }

  const v = await prisma.procesos_validaciones.findUnique({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'tesoreria_aranceles', periodo_id, estudiante_id } },
    select: { estado: true, certificado_doc_id: true }
  });
  if (!v || v.estado !== 'approved') { const e=new Error('Validación no aprobada'); e.status=409; throw e; }
  if (v.certificado_doc_id) { const e=new Error('Ya tiene certificado generado'); e.status=409; throw e; }

  const per = await prisma.periodos.findUnique({
    where: { periodo_id: Number(periodo_id) },
    select: { nombre: true }
  });
  const periodName = String(per?.nombre || '').trim();

  const externalPeriodId = await getExternalPeriodIdForLocalPeriod(Number(periodo_id));
  if (!Number.isFinite(Number(externalPeriodId))) {
    const err = new Error('No hay período externo asociado al período activo');
    err.status = 400;
    throw err;
  }

  const base = await viewsDao.getNotasResumenAprobadosByPeriodoById({
    external_period_id: Number(externalPeriodId),
    estudiante_id: Number(estudiante_id),
  });
  if (!base) {
    const err = new Error('No se encontraron datos del estudiante para el período');
    err.status = 404;
    throw err;
  }

  const estudianteNombre = String(base.nombre || '').trim();
  const estudianteCedula = String(base.cedula || '').trim();
  const carrera = String(base.carrera || '').trim();

  const issuer = issuer_id ? await usersService.getUserById(issuer_id) : null;
  const issuerFullName = issuer ? `${String(issuer.firstname || '').trim()} ${String(issuer.lastname || '').trim()}`.trim() : '';
  const issuerLabel = issuerFullName ? `Lic. ${issuerFullName}` : 'Lic.';

  const uploadsDir = path.join(process.cwd(), 'uploads', 'certificados', 'tesoreria', String(estudiante_id));
  ensureDir(uploadsDir);
  const filename = `cert_tesoreria_${estudiante_id}_${Date.now()}.pdf`;
  const abs = path.join(uploadsDir, filename);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    out.on('error', reject);

    const docPdf = new PDFDocument({ size: 'A4', margin: 50 });
    docPdf.pipe(out);

    try {
      const fondoPath = path.resolve(__dirname, '../assets/Fondo_doc.jpg');
      if (fs.existsSync(fondoPath)) {
        docPdf.image(fondoPath, 0, 0, { width: docPdf.page.width, height: docPdf.page.height });
      }
    } catch (_) { }

    try {
      const logoPath = path.resolve(__dirname, '../assets/Logo.png');
      if (fs.existsSync(logoPath)) {
        docPdf.image(logoPath, docPdf.page.margins.left, 20, { width: 170 });
      }
    } catch (_) { }

    docPdf.y = 95;

    docPdf.font('Helvetica-Bold').fontSize(14).text('CERTIFICADO DE NO ADEUDAR', { align: 'center' });
    docPdf.moveDown(1.2);

    docPdf.font('Helvetica').fontSize(11);
    const p1 = `El/la estudiante ${estudianteNombre}, con número de identificación ${estudianteCedula}, de conformidad con la normativa institucional vigente, no mantiene obligaciones pendientes de carácter económico con la institución, según consta en los archivos que reposan en el departamento de Tesorería, a los que me remitiré en caso de ser necesario; por lo tanto, se certifica que se encuentra al día en todos sus compromisos financieros.`;
    docPdf.text(p1, { align: 'justify' });
    docPdf.moveDown(1.2);

    const pageWidth = docPdf.page.width - docPdf.page.margins.left - docPdf.page.margins.right;
    const x = docPdf.page.margins.left;
    const col1 = 155;
    const col2 = pageWidth - col1;
    const rowH = 20;
    const startY = docPdf.y;

    const drawRow = (y, label, value) => {
      docPdf.rect(x, y, col1, rowH).stroke();
      docPdf.rect(x + col1, y, col2, rowH).stroke();
      docPdf.font('Helvetica-Bold').fontSize(10).text(label, x + 6, y + 6, { width: col1 - 12 });
      docPdf.font('Helvetica').fontSize(10).text(value, x + col1 + 6, y + 6, { width: col2 - 12 });
    };

    drawRow(startY, 'CARRERA:', carrera || '');
    drawRow(startY + rowH, 'PERIODO ACADÉMICO:', periodName || '');

    // Firma centrada como la plantilla (zona media-baja)
    docPdf.y = Math.round(docPdf.page.height * 0.62);

    docPdf.font('Helvetica').fontSize(11).text(issuerLabel, { align: 'center' });
    docPdf.font('Helvetica-Bold').fontSize(10).text('TESORERÍA', { align: 'center' });
    docPdf.font('Helvetica-Bold').fontSize(9).text('INSTITUTO SUPERIOR TECNOLÓGICO LOS ANDES', { align: 'center' });

    docPdf.end();
    out.on('finish', resolve);
  });

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

  // Si no existe validación o no está aprobada, Tesorería puede validar por otros medios.
  // Aprobamos y generamos certificado si falta.
  await setValidacionAranceles({ periodo_id, estudiante_id, estado: 'approved' });
  const created = await generarCertificado({ periodo_id, estudiante_id, issuer_id });
  return created.certificado_doc_id;
}

module.exports = { listResumen, aprobar, rechazar, reconsiderar, generarCertificado, ensureCertificado };
