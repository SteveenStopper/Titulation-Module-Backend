const { z } = require("zod");
const svc = require("../services/externalService");

async function health(req, res, next) {
  try { const ok = await svc.health(); res.json({ ok }); } catch (e) { next(e); }
}

async function grades(req, res, next) {
  try {
    const schema = z.object({ externalUserId: z.string().min(1), academicPeriodId: z.coerce.number().int(), viewName: z.string().min(1).optional() });
    const { externalUserId, academicPeriodId, viewName } = schema.parse(req.query || {});
    const rows = await svc.getExternalGrades({ externalUserId, academicPeriodId, viewName });
    res.json({ rows });
  } catch (e) { if (e.name==='ZodError'){ e.status=400; e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

module.exports = { health, grades };
