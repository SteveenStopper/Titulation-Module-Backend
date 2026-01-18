const { z } = require("zod");
const svc = require("../services/practicasService");

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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="certificado-practicas.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).text('Certificado de Prácticas Pre Profesionales', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Emitido por usuario: ${id_user}`);
    doc.text('Este es un certificado provisional.');
    doc.end();
  } catch (e) { next(e); }
}

module.exports = { listEligible, saveFor, certificate };
