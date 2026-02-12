const { z } = require("zod");
const tesoreriaService = require("../services/tesoreriaService");
const documentsService = require("../services/documentsService");
const prisma = require("../../prisma/client");
const viewsDao = require("../daos/viewsDao");

async function listResumen(req, res, next) {
  try {
    const schema = z.object({
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().optional(),
      minSem: z.coerce.number().int().min(0).max(4).optional(),
      academicPeriodId: z.coerce.number().int().optional(),
      careerId: z.coerce.number().int().optional(),
    });
    const { page, pageSize, minSem, academicPeriodId, careerId } = schema.parse(req.query || {});
    const result = await tesoreriaService.listResumen({ page, pageSize, minSem, academicPeriodId, careerId });
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

async function reportComprobantes(req, res, next) {
  try {
    const schema = z.object({
      academicPeriodId: z.coerce.number().int().optional(),
      careerId: z.coerce.number().int().optional(),
    });
    const { academicPeriodId, careerId } = schema.parse(req.query || {});

    const { localPeriodId, rows } = await tesoreriaService.listApprovedStudentsForPeriod({
      academicPeriodId,
      careerId,
    });
    if (!Number.isFinite(Number(localPeriodId))) return res.json({ data: [], periodId: null });

    // Scoping por rango de fechas del período (documentos no tiene periodo_id)
    let start = null;
    let end = null;
    try {
      const per = await prisma.periodos.findUnique({
        where: { periodo_id: Number(localPeriodId) },
        select: { fecha_inicio: true, fecha_fin: true },
      });
      if (per?.fecha_inicio && per?.fecha_fin) {
        start = new Date(per.fecha_inicio); start.setHours(0, 0, 0, 0);
        end = new Date(per.fecha_fin); end.setHours(23, 59, 59, 999);
      }
    } catch (_) {}

    const userIds = (rows || []).map(r => Number(r.estudiante_id)).filter(Number.isFinite);
    if (!userIds.length) return res.json({ data: [], periodId: Number(localPeriodId) });

    const tipos = ['comprobante_certificados', 'comprobante_titulacion', 'comprobante_acta_grado'];

    const docs = await prisma.documentos.findMany({
      where: {
        usuario_id: { in: userIds },
        tipo: { in: tipos },
        ...(start && end ? { creado_en: { gte: start, lte: end } } : {}),
        AND: [
          {
            OR: [
              { NOT: { pago_monto: null } },
              { NOT: { pago_referencia: null } },
              { ruta_archivo: { startsWith: 'uploads/vouchers' } },
            ],
          },
        ],
      },
      orderBy: [{ usuario_id: 'asc' }, { tipo: 'asc' }, { creado_en: 'desc' }, { documento_id: 'desc' }],
      select: { usuario_id: true, tipo: true, estado: true, creado_en: true },
    }).catch(() => []);

    // pick last doc per (user,tipo)
    const lastMap = new Map();
    for (const d of (docs || [])) {
      const key = `${Number(d.usuario_id)}|${String(d.tipo)}`;
      if (!lastMap.has(key)) lastMap.set(key, d);
    }

    const getStatus = (uid, tipo) => {
      const d = lastMap.get(`${Number(uid)}|${String(tipo)}`);
      return d?.estado || '';
    };

    const data = (rows || []).map((r, idx) => ({
      nro: idx + 1,
      estudiante_id: Number(r.estudiante_id),
      estudiante: String(r.nombre || '').trim() || `Usuario ${r.estudiante_id}`,
      carrera: String(r.carrera_nombre || '').trim() || '',
      comprobante_certificados: getStatus(r.estudiante_id, 'comprobante_certificados'),
      comprobante_titulacion: getStatus(r.estudiante_id, 'comprobante_titulacion'),
      comprobante_acta_grado: getStatus(r.estudiante_id, 'comprobante_acta_grado'),
    }));

    res.json({ periodId: Number(localPeriodId), data });
  } catch (err) {
    if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); }
    next(err);
  }
}

module.exports.reportComprobantes = reportComprobantes;

async function reportAranceles(req, res, next) {
  try {
    const schema = z.object({
      academicPeriodId: z.coerce.number().int().optional(),
      careerId: z.coerce.number().int().optional(),
    });
    const { academicPeriodId, careerId } = schema.parse(req.query || {});

    const { localPeriodId, rows } = await tesoreriaService.listApprovedStudentsForPeriod({
      academicPeriodId,
      careerId,
    });
    if (!Number.isFinite(Number(localPeriodId))) return res.json({ data: [], periodId: null });

    const ids = (rows || []).map(r => Number(r.estudiante_id)).filter(Number.isFinite);
    const validations = ids.length
      ? await prisma.procesos_validaciones.findMany({
        where: { proceso: 'tesoreria_aranceles', periodo_id: Number(localPeriodId), estudiante_id: { in: ids } },
        select: { estudiante_id: true, estado: true },
      }).catch(() => [])
      : [];
    const vMap = new Map((validations || []).map(v => [Number(v.estudiante_id), v]));

    const data = (rows || []).map((r, idx) => {
      const v = vMap.get(Number(r.estudiante_id));
      const estado = v?.estado === 'approved' ? 'Activo' : 'Inactivo';
      return {
        nro: idx + 1,
        estudiante_id: Number(r.estudiante_id),
        estudiante: String(r.nombre || '').trim() || `Usuario ${r.estudiante_id}`,
        carrera: String(r.carrera_nombre || '').trim() || '',
        estado_aranceles: estado,
      };
    });

    res.json({ periodId: Number(localPeriodId), data });
  } catch (err) {
    if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e => e.message).join(', '); }
    next(err);
  }
}

module.exports.reportAranceles = reportAranceles;

async function downloadCertificateByDoc(req, res, next) {
  try {
    const docId = Number(req.params.docId);
    if (!Number.isFinite(docId)) { const e=new Error('ID inválido'); e.status=400; throw e; }
    const inline = String(req.query?.inline || '').trim() === '1';
    const doc = await documentsService.getDocumentById(docId);
    if (!doc || !doc.ruta_archivo) { const e=new Error('Documento no encontrado'); e.status=404; throw e; }
    const abs = require('path').join(process.cwd(), doc.ruta_archivo);
    res.setHeader('Content-Type', doc.mime_type || 'application/pdf');
    const fname = doc.nombre_archivo || `certificado_${docId}.pdf`;
    if (inline) {
      res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
      return res.sendFile(abs);
    }
    return res.download(abs, fname);
  } catch (err) { next(err); }
}

async function downloadCertificateByStudent(req, res, next) {
  try {
    const estudiante_id = Number(req.params.estudiante_id);
    let periodo_id = req.query && req.query.periodo_id ? Number(req.query.periodo_id) : undefined;
    if (!Number.isFinite(estudiante_id)) { const e=new Error('estudiante_id inválido'); e.status=400; throw e; }
    const inline = String(req.query?.inline || '').trim() === '1';
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
    if (inline) {
      res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
      return res.sendFile(abs);
    }
    return res.download(abs, fname);
  } catch (err) { next(err); }
}

module.exports.downloadCertificateByDoc = downloadCertificateByDoc;
module.exports.downloadCertificateByStudent = downloadCertificateByStudent;
