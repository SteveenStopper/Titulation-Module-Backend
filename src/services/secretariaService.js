const fs = require("fs");
const path = require("path");
const prisma = require("../../prisma/client");
const viewsDao = require("../daos/viewsDao");
const usersService = require("./usersService");

async function getActivePeriodId() {
  try {
    const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    if (setting && setting.setting_value) {
      const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
      const id = Number(val?.id_academic_periods);
      if (Number.isFinite(id)) return id;
    }
  } catch (_) {
    // ignore
  }

  const last = await prisma.periodos.findFirst({ orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
  return last?.periodo_id ?? null;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function generateNotasCertificate({ studentId, academicPeriodId, issuerId }) {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (_) {
    const err = new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit');
    err.status = 501;
    throw err;
  }

  const periodo_id = academicPeriodId ?? (await getActivePeriodId());
  if (!periodo_id) {
    const err = new Error("No hay período activo configurado"); err.status = 400; throw err;
  }

  // Período local (nombre)
  const per = await prisma.periodos.findUnique({
    where: { periodo_id: Number(periodo_id) },
    select: { nombre: true }
  });
  const periodName = String(per?.nombre || '').trim();

  // Resolver período externo mapeado para obtener datos de notas/carrera desde el instituto
  let externalPeriodId = null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      `external_period_for_${Number(periodo_id)}`
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const rawVal = row ? row.setting_value : null;
    const val = rawVal ? (typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal) : null;
    const extId = Number(val?.external_period_id);
    if (Number.isFinite(extId)) externalPeriodId = extId;
  } catch (_) {
    // ignore
  }
  if (!Number.isFinite(Number(externalPeriodId))) {
    const err = new Error('No hay período externo asociado al período activo');
    err.status = 400;
    throw err;
  }

  // Datos del estudiante (roster del período externo + histórico <= período)
  const base = await viewsDao.getNotasResumenAprobadosByPeriodoById({
    external_period_id: Number(externalPeriodId),
    estudiante_id: Number(studentId),
  });
  if (!base) {
    const err = new Error('El estudiante no cumple los requisitos de aprobación para generar el certificado');
    err.status = 409;
    throw err;
  }

  const estudianteNombre = String(base.nombre || '').trim();
  const estudianteCedula = String(base.cedula || '').trim();
  const carrera = String(base.carrera || '').trim();
  const promedioGeneral = (() => {
    const n = Number(base.promedio_general);
    return Number.isFinite(n) ? n : null;
  })();

  // En el certificado se debe mostrar el período activo (local)
  const periodoAcademicoLabel = periodName;

  // Emisor (usuario local)
  const issuer = issuerId ? await usersService.getUserById(issuerId) : null;
  const issuerFullName = issuer ? `${String(issuer.firstname || '').trim()} ${String(issuer.lastname || '').trim()}`.trim() : '';
  const issuerLabel = issuerFullName ? `Lic. ${issuerFullName}` : 'Lic.';

  // 1) Crear archivo PDF
  const uploadsDir = path.join(process.cwd(), 'uploads', 'certificados', 'secretaria', 'notas', String(studentId));
  ensureDir(uploadsDir);
  const filename = `certificado_notas_${studentId}_${Date.now()}.pdf`;
  const abs = path.join(uploadsDir, filename);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    out.on('error', reject);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(out);

    try {
      const fondoPath = path.resolve(__dirname, '../assets/Fondo_doc.jpg');
      if (fs.existsSync(fondoPath)) {
        doc.image(fondoPath, 0, 0, { width: doc.page.width, height: doc.page.height });
      }
    } catch (_) { }

    try {
      const logoPath = path.resolve(__dirname, '../assets/Logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, doc.page.margins.left, 20, { width: 170 });
      }
    } catch (_) { }

    doc.y = 95;

    // Título
    doc.font('Helvetica-Bold').fontSize(14).text('CERTIFICADO DE APROBACIÓN ACADÉMICA', { align: 'center' });
    doc.moveDown(1.2);

    // Cuerpo
    doc.font('Helvetica').fontSize(11);
    doc.text('El/la estudiante ', { align: 'justify', continued: true });
    doc.font('Helvetica-Bold').text(estudianteNombre, { continued: true });
    doc.font('Helvetica').text(', con número de identificación ', { continued: true });
    doc.font('Helvetica-Bold').text(estudianteCedula, { continued: true });
    doc.font('Helvetica').text(', de conformidad con la Ley Orgánica de Educación Superior y su Reglamento, ha cumplido con los requisitos académicos respectivos y ha aprobado la totalidad de los semestres correspondientes a la malla curricular de la carrera, según consta en los archivos que reposan en la Secretaría del Instituto, a los que me remitiré en caso de ser necesario; por lo tanto, se deja constancia de la finalización satisfactoria de su proceso académico.', { continued: false });
    doc.moveDown(1.2);

    // Tabla (3 filas)
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const x = doc.page.margins.left;
    const col1 = 155;
    const col2 = pageWidth - col1;
    const rowH = 20;
    const startY = doc.y;

    const drawRow = (y, label, value) => {
      doc.rect(x, y, col1, rowH).stroke();
      doc.rect(x + col1, y, col2, rowH).stroke();
      doc.font('Helvetica-Bold').fontSize(10).text(label, x + 6, y + 6, { width: col1 - 12 });
      doc.font('Helvetica').fontSize(10).text(value, x + col1 + 6, y + 6, { width: col2 - 12 });
    };

    drawRow(startY, 'CARRERA:', carrera || '');
    drawRow(startY + rowH, 'PERIODO ACADÉMICO:', periodoAcademicoLabel);
    drawRow(startY + rowH * 2, 'PROMEDIO GENERAL:', promedioGeneral !== null ? promedioGeneral.toFixed(2) : '');

    // Ubicar firma centrada como la plantilla (zona media-baja)
    doc.y = Math.round(doc.page.height * 0.54);

    // Firma
    doc.font('Helvetica').fontSize(11).text(issuerLabel, { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10).text('SECRETARIA', { align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).text('INSTITUTO SUPERIOR TECNOLÓGICO LOS ANDES', { align: 'center' });

    doc.end();
    out.on('finish', resolve);
  });
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");

  // 2) Crear documento en nuevo repositorio
  const doc = await prisma.documentos.create({
    data: {
      tipo: 'cert_secretaria',
      nombre_archivo: filename,
      ruta_archivo: rel,
      mime_type: 'application/pdf',
      usuario_id: issuerId,
      estudiante_id: studentId,
    },
    select: { documento_id: true },
  });

  // 3) Enlazar a procesos_validaciones (proceso secretaria_promedios)
  await prisma.procesos_validaciones.upsert({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'secretaria_promedios', periodo_id, estudiante_id: studentId } },
    update: { estado: 'approved', certificado_doc_id: doc.documento_id },
    create: { proceso: 'secretaria_promedios', periodo_id, estudiante_id: studentId, estado: 'approved', certificado_doc_id: doc.documento_id },
  });

  return { documento_id: doc.documento_id, ruta: rel };
}

module.exports = { generateNotasCertificate };

async function setValidacionPromedios({ periodo_id, estudiante_id, estado, observacion = null }) {
  const proceso = 'secretaria_promedios';
  return prisma.procesos_validaciones.upsert({
    where: { proceso_periodo_id_estudiante_id: { proceso, periodo_id, estudiante_id } },
    update: { estado, observacion },
    create: { proceso, periodo_id, estudiante_id, estado, observacion },
    select: { proceso_validacion_id: true, estado: true }
  });
}

async function aprobar({ periodo_id, estudiante_id }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'approved' });
}

async function rechazar({ periodo_id, estudiante_id, observacion }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'rejected', observacion: observacion ?? null });
}

module.exports.aprobar = aprobar;
module.exports.rechazar = rechazar;

async function reconsiderar({ periodo_id, estudiante_id }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'pending', observacion: null });
}

module.exports.reconsiderar = reconsiderar;
