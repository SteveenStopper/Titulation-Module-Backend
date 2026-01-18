const { z } = require("zod");
const svc = require("../services/clearancesService");

async function listGrades(req, res, next) { try { const q=z.object({academicPeriodId:z.coerce.number().int().optional()}).parse(req.query||{}); const data=await svc.listGradeClearances(q); res.json(data);} catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }
async function setGrade(req, res, next) {
  try {
    const b=z.object({ id_user:z.coerce.number().int(), status:z.enum(['pending','approved','rejected']), observation:z.string().optional(), academicPeriodId:z.coerce.number().int().optional()}).parse(req.body||{});
    const data=await svc.setGradeClearance(b); res.json(data);
  } catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }

async function listFees(req, res, next) { try { const q=z.object({academicPeriodId:z.coerce.number().int().optional()}).parse(req.query||{}); const data=await svc.listFeeClearances(q); res.json(data);} catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }
async function setFee(req, res, next) {
  try {
    const b=z.object({ id_user:z.coerce.number().int(), status:z.enum(['pending','approved','rejected']), observation:z.string().optional(), academicPeriodId:z.coerce.number().int().optional()}).parse(req.body||{});
    const data=await svc.setFeeClearance(b); res.json(data);
  } catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} }

module.exports = { listGrades, setGrade, listFees, setFee };
