const { z } = require("zod");
const svc = require("../services/practicasService");
const prisma = require("../../prisma/client");
const fs = require("fs");
const path = require("path");
const usersService = require("../services/usersService");
const vouchersService = require("../services/vouchersService");

async function listEligible(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const rows = await svc.listEligible({ academicPeriodId });
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function saveFor(req, res, next) {
  try {
    const schema = z.object({ target_user_id: z.coerce.number().int(), score: z.coerce.number(), academicPeriodId: z.coerce.number().int().optional() });
    const { target_user_id, score, academicPeriodId } = schema.parse(req.body || {});
    const data = await svc.saveFor({ target_user_id, academicPeriodId, score });
    res.status(201).json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function certificate(req, res, next) {
  try {
    let PDFDocument;
    try { PDFDocument = require('pdfkit'); }
    catch (_) { const err=new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit'); err.status=501; throw err; }

    const requesterId = req.user?.sub;
    if (!requesterId) { const e = new Error('No autorizado'); e.status=401; throw e; }

    const roles = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
    const allowed = roles.includes('Administrador') || roles.includes('Vinculacion_Practicas');
    if (!allowed) { const e = new Error('No autorizado'); e.status = 403; throw e; }

    const bodySchema = z.object({ target_user_id: z.coerce.number().int() });
    const { target_user_id } = bodySchema.parse(req.body || {});
    const studentId = Number(target_user_id);

    // Período activo (local)
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const periodo_id = Number(per?.id_academic_periods);
    if (!Number.isFinite(periodo_id)) { const e = new Error('No hay período activo configurado'); e.status = 400; throw e; }

    const periodRow = await prisma.periodos.findUnique({ where: { periodo_id }, select: { nombre: true } });
    const periodName = String(periodRow?.nombre || '').trim();

    const u = await prisma.usuarios.findUnique({ where: { usuario_id: Number(studentId) }, select: { nombre: true, apellido: true } });
    const estudianteNombre = u ? `${String(u.nombre || '').trim()} ${String(u.apellido || '').trim()}`.trim() : `Usuario ${studentId}`;

    let estudianteCedula = '';
    try {
      const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
      const rows = await prisma.$queryRawUnsafe(`SELECT DOCUMENTO_USUARIOS AS cedula FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS WHERE ID_USUARIOS = ? LIMIT 1`, Number(studentId));
      if (Array.isArray(rows) && rows[0]?.cedula) estudianteCedula = String(rows[0].cedula).trim();
    } catch (_) { estudianteCedula = ''; }

    const careerMap = await vouchersService.getCareerMapForUserIds([Number(studentId)]);
    const carrera = String(careerMap.get(Number(studentId)) || '').trim();

    const grade = await prisma.academic_grades.findUnique({
      where: { module_id_user_id_academic_periods: { module: 'practicas', id_user: Number(studentId), id_academic_periods: Number(periodo_id) } },
      select: { score: true }
    }).catch(() => null);
    const score = grade?.score != null ? Number(grade.score) : null;

    const issuer = await usersService.getUserById(Number(requesterId));
    const issuerFullName = issuer ? `${String(issuer.firstname || '').trim()} ${String(issuer.lastname || '').trim()}`.trim() : '';
    const issuerLabel = issuerFullName ? `Lic. ${issuerFullName}` : 'Lic.';

    const uploadsDir = path.join(process.cwd(), 'uploads', 'certificados', 'practicas', String(studentId));
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `cert_practicas_${studentId}_${Date.now()}.pdf`;
    const abs = path.join(uploadsDir, filename);

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(abs);
      out.on('error', reject);
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.pipe(out);

      try {
        const fondoPath = path.resolve(__dirname, '../assets/Fondo_doc.jpg');
        if (fs.existsSync(fondoPath)) doc.image(fondoPath, 0, 0, { width: doc.page.width, height: doc.page.height });
      } catch (_) { }

      try {
        const logoPath = path.resolve(__dirname, '../assets/Logo.png');
        if (fs.existsSync(logoPath)) doc.image(logoPath, doc.page.margins.left, 20, { width: 170 });
      } catch (_) { }

      doc.y = 95;
      doc.font('Helvetica-Bold').fontSize(14).text('CERTIFICADO DE PRÁCTICAS PREPROFESIONALES', { align: 'center' });
      doc.moveDown(1.2);

      doc.font('Helvetica').fontSize(11);
      const p1 = `El/la estudiante ${estudianteNombre}, con número de identificación ${estudianteCedula}, de conformidad con la Ley Orgánica de Educación Superior y su Reglamento, ha cumplido con los requisitos respectivos de Prácticas Preprofesionales, desarrollando actividades acordes a su perfil académico y completando el número de horas exigidas, según consta en los archivos que reposan en la Coordinación de Prácticas, a los que me remitiré en caso de ser necesario; por lo tanto, se certifica el cumplimiento de este requisito previo a su proceso de titulación.`;
      doc.text(p1, { align: 'justify' });
      doc.moveDown(1.2);

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
      drawRow(startY + rowH, 'PERIODO ACADÉMICO:', periodName || '');
      drawRow(startY + rowH * 2, 'CALIFICACIÓN:', score != null ? String(score) : '');

      doc.y = Math.round(doc.page.height * 0.62);
      const sigW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const sigX = doc.page.margins.left;
      doc.font('Helvetica').fontSize(11).text(issuerLabel, sigX, doc.y, { width: sigW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(10).text('PRÁCTICAS PREPROFESIONALES', sigX, doc.y, { width: sigW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(9).text('INSTITUTO SUPERIOR TECNOLÓGICO LOS ANDES', sigX, doc.y, { width: sigW, align: 'center' });

      doc.end();
      out.on('finish', resolve);
    });

    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    await prisma.documentos.create({
      data: {
        tipo: 'cert_practicas',
        ruta_archivo: rel,
        nombre_archivo: filename,
        mime_type: 'application/pdf',
        usuario_id: Number(requesterId),
        estudiante_id: Number(studentId),
      },
      select: { documento_id: true },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificado-practicas.pdf"');
    const stream = fs.createReadStream(abs);
    stream.on('error', next);
    stream.pipe(res);
  } catch (e) { next(e); }
}

module.exports = { listEligible, saveFor, certificate };
