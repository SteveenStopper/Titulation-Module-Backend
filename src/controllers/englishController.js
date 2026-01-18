const { z } = require("zod");
const svc = require("../services/englishService");
const prisma = require("../../prisma/client");

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

    const id_user = req.user?.sub; if (!id_user) { const e = new Error('No autorizado'); e.status=401; throw e; }
    const grade = await svc.getMy({ id_user });
    const score = grade?.score != null ? Number(grade.score) : null;
    const status = grade?.status || 'sin_registro';

    // Prepare response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificado-ingles.pdf"');

    // Generate a very simple PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).text('Certificado de Inglés', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Usuario: ${id_user}`);
    doc.text(`Calificación: ${score != null ? score : 'N/A'}`);
    doc.text(`Estado: ${status}`);
    doc.moveDown();
    const now = new Date();
    doc.text(`Emitido: ${now.toISOString().slice(0,10)} ${now.toTimeString().slice(0,8)}`);
    doc.end();
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
