const { z } = require("zod");
const svc = require("../services/englishService");
const prisma = require("../../prisma/client");
const fs = require("fs");
const path = require("path");
const usersService = require("../services/usersService");
const vouchersService = require("../services/vouchersService");

async function getActiveAcademicPeriodId(override) {
  const o = Number(override);
  if (Number.isFinite(o)) return o;
  try {
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id = Number(per?.id_academic_periods);
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

async function getMy(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const id_user = req.user?.sub; if (!id_user) { const e = new Error("No autorizado"); e.status=401; throw e; }
    const data = await svc.getMy({ id_user, academicPeriodId });
    res.json(data || {});
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function saveMy(req, res, next) {
  try {
    const schema = z.object({ score: z.coerce.number(), academicPeriodId: z.coerce.number().int().optional() });
    const { score, academicPeriodId } = schema.parse(req.body || {});
    const id_user = req.user?.sub; if (!id_user) { const e = new Error("No autorizado"); e.status=401; throw e; }
    const data = await svc.saveMy({ id_user, academicPeriodId, score });
    res.status(201).json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function validate(req, res, next) {
  try {
    const schema = z.object({ id: z.coerce.number().int() });
    const { id } = schema.parse({ id: req.params.id });
    const validatorId = req.user?.sub; if (!validatorId){ const e = new Error("No autorizado"); e.status=401; throw e; }
    const data = await svc.validate({ id, validatorId });
    res.json(data);
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

module.exports = { getMy, saveMy, validate };

async function certificate(req, res, next) {
  try {
    // Try to require pdfkit lazily
    let PDFDocument;
    try {
      PDFDocument = require('pdfkit');
    } catch (e) {
      const err = new Error('Generación de PDF no disponible. Instala la dependencia: npm i pdfkit');
      err.status = 501; throw err;
    }

    const requesterId = req.user?.sub;
    if (!requesterId) { const e = new Error('No autorizado'); e.status=401; throw e; }

    const roles = Array.isArray(req.user?.roles) ? req.user.roles.map(String) : [];
    const isAdminIngles = roles.includes('Administrador') || roles.includes('Ingles');

    const bodySchema = z.object({ target_user_id: z.coerce.number().int().optional() });
    const { target_user_id } = bodySchema.parse(req.body || {});
    const studentId = (Number.isFinite(Number(target_user_id)) && isAdminIngles)
      ? Number(target_user_id)
      : Number(requesterId);

    // Período activo (local)
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const periodo_id = Number(per?.id_academic_periods);
    if (!Number.isFinite(periodo_id)) { const e = new Error('No hay período activo configurado'); e.status = 400; throw e; }

    const periodRow = await prisma.periodos.findUnique({ where: { periodo_id }, select: { nombre: true } });
    const periodName = String(periodRow?.nombre || '').trim();

    // Datos estudiante (nombre local + cédula/carrera desde SIGALA)
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
      where: { module_id_user_id_academic_periods: { module: 'english', id_user: Number(studentId), id_academic_periods: Number(periodo_id) } },
      select: { score: true, status: true }
    }).catch(() => null);
    const score = grade?.score != null ? Number(grade.score) : null;

    // Emisor
    const issuer = await usersService.getUserById(Number(requesterId));
    const issuerFullName = issuer ? `${String(issuer.firstname || '').trim()} ${String(issuer.lastname || '').trim()}`.trim() : '';
    const issuerLabel = issuerFullName ? `Lic. ${issuerFullName}` : 'Lic.';

    // Crear PDF en disco + registrar en documentos
    const uploadsDir = path.join(process.cwd(), 'uploads', 'certificados', 'ingles', String(studentId));
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `cert_ingles_${studentId}_${Date.now()}.pdf`;
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

      doc.font('Helvetica-Bold').fontSize(14).text('CERTIFICADO DE INGLES', { align: 'center' });
      doc.moveDown(1.2);

      doc.font('Helvetica').fontSize(11);
      const p1 = `El/la estudiante ${estudianteNombre}, con número de identificación ${estudianteCedula}, de conformidad con la Ley Orgánica de Educación Superior y su Reglamento, ha cumplido con los requisitos respectivos y ha aprobado el programa institucional de Idioma Inglés, alcanzando el nivel exigido según consta en los archivos que reposan en la Coordinación de Idiomas, a los que me remitiré en caso de ser necesario; por lo tanto, se certifica su suficiencia en el idioma inglés como requisito académico institucional.`;
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
      doc.font('Helvetica-Bold').fontSize(10).text('IDIOMAS - INGLES', sigX, doc.y, { width: sigW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(9).text('INSTITUTO SUPERIOR TECNOLÓGICO LOS ANDES', sigX, doc.y, { width: sigW, align: 'center' });

      doc.end();
      out.on('finish', resolve);
    });

    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    await prisma.documentos.create({
      data: {
        tipo: 'cert_ingles',
        ruta_archivo: rel,
        nombre_archivo: filename,
        mime_type: 'application/pdf',
        usuario_id: Number(requesterId),
        estudiante_id: Number(studentId),
      },
      select: { documento_id: true },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificado-ingles.pdf"');
    const stream = fs.createReadStream(abs);
    stream.on('error', next);
    stream.pipe(res);
  } catch (e) { next(e); }
}

module.exports = { getMy, saveMy, validate, certificate };

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

module.exports.listEligible = listEligible;
module.exports.saveFor = saveFor;

async function dashboard(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const id_ap = await getActiveAcademicPeriodId(academicPeriodId);
    if (!Number.isFinite(Number(id_ap))) {
      return res.json({
        elegibles: 0,
        calificacionesGuardadas: 0,
        calificacionesValidadas: 0,
        pendientesValidacion: 0,
        certificadosEmitidosHoy: 0,
      });
    }
    const start = new Date(); start.setHours(0, 0, 0, 0);

    const [elegibles, califGuardadas, califValidadas, certHoy] = await Promise.all([
      prisma.procesos_validaciones.count({ where: { proceso: 'tesoreria_aranceles', periodo_id: Number(id_ap), estado: 'approved' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'english', id_academic_periods: Number(id_ap), status: 'saved' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'english', id_academic_periods: Number(id_ap), status: 'validated' } }).catch(() => 0),
      prisma.documentos.count({ where: { tipo: 'cert_ingles', creado_en: { gte: start } } }).catch(() => 0),
    ]);
    const pendientesValidacion = Number(califGuardadas || 0);
    res.json({
      elegibles: Number(elegibles || 0),
      calificacionesGuardadas: Number(califGuardadas || 0),
      calificacionesValidadas: Number(califValidadas || 0),
      pendientesValidacion,
      certificadosEmitidosHoy: Number(certHoy || 0),
    });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e); }
}

async function recientes(req, res, next) {
  try {
    const schema = z.object({
      days: z.coerce.number().int().positive().optional(),
      academicPeriodId: z.coerce.number().int().optional(),
    });
    const { days = 7, academicPeriodId } = schema.parse(req.query || {});
    const id_ap = await getActiveAcademicPeriodId(academicPeriodId);
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    const since = new Date(); since.setDate(since.getDate() - Number(days));

    const [grades, docs] = await Promise.all([
      prisma.academic_grades.findMany({
        where: { module: 'english', id_academic_periods: Number(id_ap), updated_at: { gte: since } },
        orderBy: { updated_at: 'desc' },
        take: 10,
        select: {
          updated_at: true,
          status: true,
          id_user: true,
          usuarios_academic_grades_id_userTousuarios: { select: { usuario_id: true, nombre: true, apellido: true } },
        },
      }).catch(() => []),
      prisma.documentos.findMany({
        where: { tipo: 'cert_ingles', creado_en: { gte: since } },
        orderBy: { creado_en: 'desc' },
        take: 10,
        select: { creado_en: true, usuario_id: true },
      }).catch(() => []),
    ]);

    const items = [];
    for (const g of (grades || [])) {
      const u = g.usuarios_academic_grades_id_userTousuarios;
      const estudiante = u ? `${u.nombre} ${u.apellido}`.trim() : `Usuario ${g.id_user}`;
      items.push({
        estudiante,
        tramite: 'Calificación de Inglés',
        fecha: g.updated_at,
        estado: String(g.status) === 'validated' ? 'completado' : 'pendiente',
      });
    }
    for (const d of (docs || [])) {
      items.push({
        estudiante: `Usuario ${d.usuario_id}`,
        tramite: 'Emisión de certificado',
        fecha: d.creado_en,
        estado: 'completado',
      });
    }
    items.sort((a,b)=> new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    res.json(items.slice(0, 10));
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e); }
}

module.exports.dashboard = dashboard;
module.exports.recientes = recientes;
