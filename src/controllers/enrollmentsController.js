const { z } = require("zod");
const enrollmentsService = require("../services/enrollmentsService");

async function select(req, res, next) {
  try {
    const schema = z.object({
      modality: z.enum(["UIC", "EXAMEN_COMPLEXIVO"]),
      academicPeriodId: z.coerce.number().int().optional(),
    });
    const { modality, academicPeriodId } = schema.parse(req.body || {});
    const id_user = req.user?.sub;
    if (!id_user) {
      const err = new Error("No autorizado");
      err.status = 401;
      throw err;
    }
    const result = await enrollmentsService.selectModality({ id_user, academicPeriodId, modality });
    res.status(201).json(result);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    next(err);
  }
}

async function current(req, res, next) {
  try {
    const schema = z.object({ academicPeriodId: z.coerce.number().int().optional() });
    const { academicPeriodId } = schema.parse(req.query || {});
    const id_user = req.user?.sub;
    if (!id_user) {
      const err = new Error("No autorizado");
      err.status = 401;
      throw err;
    }
    const result = await enrollmentsService.getCurrentSelection({ id_user, academicPeriodId });
    res.json(result || {});
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    next(err);
  }
}

module.exports = { select, current };
async function list(req, res, next) {
  try {
    const schema = z.object({
      status: z.string().optional(),
      academicPeriodId: z.coerce.number().int().optional(),
      modality: z.enum(["UIC","EXAMEN_COMPLEXIVO"]).optional(),
    });
    const filters = schema.parse(req.query || {});
    const rows = await enrollmentsService.list(filters);
    res.json(rows);
  } catch (err) { if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e=>e.message).join(', ');} next(err); }
}

async function approve(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { const e=new Error('ID inválido'); e.status=400; throw e; }
    const updated = await enrollmentsService.setStatus({ id, status: 'approved' });
    res.json(updated);
  } catch (err) { next(err); }
}

async function reject(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { const e=new Error('ID inválido'); e.status=400; throw e; }
    const updated = await enrollmentsService.setStatus({ id, status: 'rejected' });
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { select, current, list, approve, reject };
