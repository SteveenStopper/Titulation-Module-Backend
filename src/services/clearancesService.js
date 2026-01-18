const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!setting || !setting.setting_value) return null;
  const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
  return val?.id_academic_periods ?? null;
}

async function listGradeClearances({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  return prisma.grade_clearances.findMany({
    where: { id_academic_periods: id_ap },
    select: { id: true, id_user: true, id_academic_periods: true, status: true, observation: true, checked_at: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } } },
  });
}

async function setGradeClearance({ id_user, status, observation, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }
  return prisma.grade_clearances.upsert({
    where: { id_user_id_academic_periods: { id_user, id_academic_periods: id_ap } },
    create: { id_user, id_academic_periods: id_ap, status, observation: observation ?? null, checked_at: new Date() },
    update: { status, observation: observation ?? null, checked_at: new Date() },
    select: { id: true, id_user: true, status: true, observation: true, checked_at: true },
  });
}

async function listFeeClearances({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  return prisma.fee_clearances.findMany({
    where: { id_academic_periods: id_ap },
    select: { id: true, id_user: true, id_academic_periods: true, status: true, observation: true, checked_at: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } } },
  });
}

async function setFeeClearance({ id_user, status, observation, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }
  return prisma.fee_clearances.upsert({
    where: { id_user_id_academic_periods: { id_user, id_academic_periods: id_ap } },
    create: { id_user, id_academic_periods: id_ap, status, observation: observation ?? null, checked_at: new Date() },
    update: { status, observation: observation ?? null, checked_at: new Date() },
    select: { id: true, id_user: true, status: true, observation: true, checked_at: true },
  });
}

module.exports = { listGradeClearances, setGradeClearance, listFeeClearances, setFeeClearance };
