const { z } = require("zod");
const svc = require("../services/vincService");
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
    const id_user = req.user?.sub; if (!id_user) { const e = new Error('No autorizado'); e.status=401; throw e; }

    // Datos simples del emisor (para demo)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificado-vinculacion.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).text('Certificado de Vinculación', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Emitido por usuario: ${id_user}`);
    doc.text('Este es un certificado provisional.');
    doc.end();
  } catch (e) { next(e); }
}

module.exports = { listEligible, saveFor, certificate };

async function dashboard(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const id_ap = await getActiveAcademicPeriodId(academicPeriodId);
    if (!Number.isFinite(Number(id_ap))) {
      return res.json({
        elegibles: 0,
        vinculacionGuardadas: 0,
        vinculacionValidadas: 0,
        practicasGuardadas: 0,
        practicasValidadas: 0,
        certificadosEmitidosHoy: 0,
      });
    }
    const start = new Date(); start.setHours(0, 0, 0, 0);

    const [elegibles, vSaved, vVal, pSaved, pVal, certHoy] = await Promise.all([
      prisma.procesos_validaciones.count({ where: { proceso: 'tesoreria_aranceles', periodo_id: Number(id_ap), estado: 'approved' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'vinculacion', id_academic_periods: Number(id_ap), status: 'saved' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'vinculacion', id_academic_periods: Number(id_ap), status: 'validated' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'practicas', id_academic_periods: Number(id_ap), status: 'saved' } }).catch(() => 0),
      prisma.academic_grades.count({ where: { module: 'practicas', id_academic_periods: Number(id_ap), status: 'validated' } }).catch(() => 0),
      prisma.documentos.count({ where: { tipo: { in: ['cert_vinculacion', 'cert_practicas'] }, creado_en: { gte: start } } }).catch(() => 0),
    ]);
    res.json({
      elegibles: Number(elegibles || 0),
      vinculacionGuardadas: Number(vSaved || 0),
      vinculacionValidadas: Number(vVal || 0),
      practicasGuardadas: Number(pSaved || 0),
      practicasValidadas: Number(pVal || 0),
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

    const [grades, docs, users] = await Promise.all([
      prisma.academic_grades.findMany({
        where: { module: { in: ['vinculacion', 'practicas'] }, id_academic_periods: Number(id_ap), updated_at: { gte: since } },
        orderBy: { updated_at: 'desc' },
        take: 10,
        select: { module: true, updated_at: true, status: true, id_user: true }
      }).catch(() => []),
      prisma.documentos.findMany({
        where: { tipo: { in: ['cert_vinculacion', 'cert_practicas'] }, creado_en: { gte: since } },
        orderBy: { creado_en: 'desc' },
        take: 10,
        select: { creado_en: true, usuario_id: true, tipo: true },
      }).catch(() => []),
      prisma.usuarios.findMany({
        where: { usuario_id: { in: Array.from(new Set([...(grades || []).map(g => Number(g.id_user)), ...(docs || []).map(d => Number(d.usuario_id))].filter(n => Number.isFinite(n)))) } },
        select: { usuario_id: true, nombre: true, apellido: true }
      }).catch(() => []),
    ]);

    const nameMap = new Map((users || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));

    const items = [];
    for (const g of (grades || [])) {
      items.push({
        estudiante: nameMap.get(Number(g.id_user)) || `Usuario ${g.id_user}`,
        tramite: String(g.module) === 'practicas' ? 'Calificación de Prácticas' : 'Calificación de Vinculación',
        fecha: g.updated_at,
        estado: String(g.status) === 'validated' ? 'completado' : 'pendiente',
      });
    }
    for (const d of (docs || [])) {
      items.push({
        estudiante: nameMap.get(Number(d.usuario_id)) || `Usuario ${d.usuario_id}`,
        tramite: String(d.tipo) === 'cert_practicas' ? 'Emisión de certificado de Prácticas' : 'Emisión de certificado de Vinculación',
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
