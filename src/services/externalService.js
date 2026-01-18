const adapter = require("../adapters/externalDb");
const prisma = require("../../prisma/client");

async function health() {
  try { return await adapter.health(); } catch (_) { return false; }
}

async function getExternalGrades({ externalUserId, academicPeriodId, viewName }) {
  // Resolve external period id using period_mappings
  const pm = await prisma.period_mappings.findUnique({ where: { id_academic_periods: academicPeriodId } });
  if (!pm) {
    const e = new Error("No existe mapeo de período externo. Configure period_mappings");
    e.status = 400; throw e;
  }
  const rows = await adapter.queryGradesFromView({ viewName: viewName || "vw_grades", external_user_id: externalUserId, external_period_id: pm.external_period_id });
  return rows;
}

module.exports = { health, getExternalGrades };
