const { z } = require("zod");
const tesoreriaService = require("../services/tesoreriaService");
const documentsService = require("../services/documentsService");

async function listResumen(req, res, next) {
  try {
    const schema = z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
      minSem: z.coerce.number().int().min(0).max(4).optional(),
    });
    const { page, pageSize, minSem } = schema.parse(req.query || {});
    const result = await tesoreriaService.listResumen({ page, pageSize, minSem });
    res.json(result);
  } catch (err) {
    if (err.name === "ZodError") { err.status = 400; err.message = err.errors.map(e=>e.message).join(", "); }
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const schema = z.object({
      periodo_id: z.coerce.number().int(),
      estudiante_id: z.coerce.number().int(),
    });
    const { periodo_id, estudiante_id } = schema.parse(req.body || {});
    const updated = await tesoreriaService.aprobar({ periodo_id, estudiante_id });
    res.json(updated);
  } catch (err) { if (err.name === "ZodError") { err.status=400; err.message=err.errors.map(e=>e.message).join(", "); } next(err); }
}

async function reject(req, res, next) {
  try {
    const schema = z.object({
      periodo_id: z.coerce.number().int(),
      estudiante_id: z.coerce.number().int(),
      observacion: z.string().optional(),
    });
    const { periodo_id, estudiante_id, observacion } = schema.parse(req.body || {});
    const updated = await tesoreriaService.rechazar({ periodo_id, estudiante_id, observacion });
    res.json(updated);
  } catch (err) { if (err.name === "ZodError") { err.status=400; err.message=err.errors.map(e=>e.message).join(", "); } next(err); }
}

async function reconsider(req, res, next) {
  try {
    const schema = z.object({
      periodo_id: z.coerce.number().int(),
      estudiante_id: z.coerce.number().int(),
    });
    const { periodo_id, estudiante_id } = schema.parse(req.body || {});
    const updated = await tesoreriaService.reconsiderar({ periodo_id, estudiante_id });
    res.json(updated);
  } catch (err) { if (err.name === "ZodError") { err.status=400; err.message=err.errors.map(e=>e.message).join(", "); } next(err); }
}

async function generateCertificate(req, res, next) {
  try {
    const schema = z.object({
      periodo_id: z.coerce.number().int(),
      estudiante_id: z.coerce.number().int(),
    });
    const { periodo_id, estudiante_id } = schema.parse(req.body || {});
    const issuer_id = req.user?.sub;
    const result = await tesoreriaService.generarCertificado({ periodo_id, estudiante_id, issuer_id });
    res.status(201).json(result);
  } catch (err) { if (err.name === "ZodError") { err.status=400; err.message=err.errors.map(e=>e.message).join(", "); } next(err); }
}

module.exports = { listResumen, approve, reject, reconsider, generateCertificate };

async function downloadCertificateByDoc(req, res, next) {
  try {
    const docId = Number(req.params.docId);
    if (!Number.isFinite(docId)) { const e=new Error('ID inválido'); e.status=400; throw e; }
    const doc = await documentsService.getDocumentById(docId);
    if (!doc || !doc.ruta_archivo) { const e=new Error('Documento no encontrado'); e.status=404; throw e; }
    const abs = require('path').join(process.cwd(), doc.ruta_archivo);
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
    const fname = doc.nombre_archivo || `certificado_${docId}.pdf`;
    return res.download(abs, fname);
  } catch (err) { next(err); }
}

async function downloadCertificateByStudent(req, res, next) {
  try {
    const estudiante_id = Number(req.params.estudiante_id);
    let periodo_id = req.query && req.query.periodo_id ? Number(req.query.periodo_id) : undefined;
    if (!Number.isFinite(estudiante_id)) { const e=new Error('estudiante_id inválido'); e.status=400; throw e; }
    const prisma = require('../../prisma/client');

    // Por defecto, usar período activo (evita traer certificados viejos)
    if (!Number.isFinite(Number(periodo_id))) {
      try {
        const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
        const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
        const id_ap = per?.id_academic_periods ? Number(per.id_academic_periods) : null;
        if (Number.isFinite(Number(id_ap))) periodo_id = Number(id_ap);
      } catch (_) {}
    }

    let pv = await prisma.procesos_validaciones.findFirst({
      where: periodo_id ? { proceso: 'tesoreria_aranceles', periodo_id, estudiante_id, certificado_doc_id: { not: null } } : { proceso: 'tesoreria_aranceles', estudiante_id, certificado_doc_id: { not: null } },
      orderBy: { actualizado_en: 'desc' },
      select: { certificado_doc_id: true },
    });
    // Si no hay certificado, intentar revalidar+generar de forma automática (requiere periodo_id)
    if ((!pv || !pv.certificado_doc_id) && Number.isFinite(periodo_id)) {
      const issuer_id = req.user?.sub;
      try {
        const docId = await tesoreriaService.ensureCertificado({ periodo_id, estudiante_id, issuer_id });
        pv = { certificado_doc_id: docId };
      } catch (e) {
        // si no está al día, devolver conflicto claro
        if (e && e.status) throw e;
        const err = new Error('No se pudo generar certificado');
        err.status = 500; throw err;
      }
    }
    if (!pv || !pv.certificado_doc_id) { const e=new Error('Sin certificado generado'); e.status=404; throw e; }
    const doc = await documentsService.getDocumentById(pv.certificado_doc_id);
    if (!doc || !doc.ruta_archivo) { const e=new Error('Documento no encontrado'); e.status=404; throw e; }
    const abs = require('path').join(process.cwd(), doc.ruta_archivo);
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
    const fname = doc.nombre_archivo || `certificado_tesoreria_${estudiante_id}.pdf`;
    return res.download(abs, fname);
  } catch (err) { next(err); }
}

module.exports.downloadCertificateByDoc = downloadCertificateByDoc;
module.exports.downloadCertificateByStudent = downloadCertificateByStudent;
