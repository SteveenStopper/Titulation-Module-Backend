const { z } = require("zod");
const svc = require("../services/cronogramasService");

async function getUltimoUIC(req, res, next) {
  try { const data = await svc.getUltimoUIC(); res.json(data || null); } catch (e) { next(e); }
}

async function createDraft(req, res, next) {
  try {
    const schema = z.object({
      academicPeriodId: z.coerce.number().int().optional(),
      modalidad: z.enum(['UIC','EXAMEN_COMPLEXIVO'])
    });
    const { academicPeriodId, modalidad } = schema.parse(req.query || {});
    const data = await svc.crearBorradorDesdeAnterior({ academicPeriodId, modalidad });
    res.json(data || null);
  } catch (e) { if (e.name === 'ZodError') { e.status = 400; e.message = e.errors.map(x=>x.message).join(', ');} next(e); }
}

 

async function getUICByPeriod(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const data = await svc.getUICByPeriod({ academicPeriodId });
    res.json(data || null);
  } catch (e) { if (e.name === 'ZodError') { e.status = 400; e.message = e.errors.map(x=>x.message).join(', ');} next(e); }
}

async function publicarUIC(req, res, next) {
  try {
    const schema = z.object({
      academicPeriodId: z.coerce.number().int().optional(),
      title: z.string().min(1),
      period_label: z.string().min(1),
      project_label: z.string().min(1),
      items: z.array(z.object({
        row_number: z.coerce.number().int().optional(),
        activity_description: z.string().min(1),
        responsible: z.string().min(1),
        date_start: z.string().datetime().optional(),
        date_end: z.string().datetime().optional(),
      })).default([]),
    });
    const input = schema.parse(req.body || {});
    const id_owner = req.user?.sub;
    const data = await svc.publicarUIC({ id_owner, ...input });
    // Notificar a Estudiantes y Docentes que se publicó cronograma UIC
    try {
      const notifications = require("../services/notificationsService");
      await notifications.notifyRoles({
        roles: ['Estudiante','Docente'],
        type: 'cronograma_publicado',
        title: 'Cronograma UIC publicado',
        message: `${input.title} - ${input.period_label}`,
        entity_type: 'cronograma_uic',
        entity_id: 0,
      });
    } catch (_) { /* no bloquear */ }
    res.status(201).json(data);
  } catch (e) { if (e.name === 'ZodError') { e.status = 400; e.message = e.errors.map(x=>x.message).join(', ');} next(e); }
}

// Complexivo
async function getComplexivoByPeriod(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const data = await svc.getComplexivoByPeriod({ academicPeriodId });
    res.json(data || null);
  } catch (e) { if (e.name === 'ZodError') { e.status = 400; e.message = e.errors.map(x=>x.message).join(', ');} next(e); }
}

async function publicarComplexivo(req, res, next) {
  try {
    const schema = z.object({
      academicPeriodId: z.coerce.number().int().optional(),
      title: z.string().min(1),
      period_label: z.string().min(1),
      project_label: z.string().min(1),
      items: z.array(z.object({
        row_number: z.coerce.number().int().optional(),
        activity_description: z.string().min(1),
        responsible: z.string().min(1),
        date_start: z.string().datetime().optional(),
        date_end: z.string().datetime().optional(),
      })).default([]),
    });
    const input = schema.parse(req.body || {});
    const id_owner = req.user?.sub;
    const data = await svc.publicarComplexivo({ id_owner, ...input });
    // Notificar a Estudiantes y Docentes que se publicó cronograma Complexivo
    try {
      const notifications = require("../services/notificationsService");
      await notifications.notifyRoles({
        roles: ['Estudiante','Docente'],
        type: 'cronograma_publicado',
        title: 'Cronograma Complexivo publicado',
        message: `${input.title} - ${input.period_label}`,
        entity_type: 'cronograma_complexivo',
        entity_id: 0,
      });
    } catch (_) { /* no bloquear */ }
    res.status(201).json(data);
  } catch (e) { if (e.name === 'ZodError') { e.status = 400; e.message = e.errors.map(x=>x.message).join(', ');} next(e); }
}

module.exports = { getUltimoUIC, getUICByPeriod, publicarUIC, getComplexivoByPeriod, publicarComplexivo, createDraft };
