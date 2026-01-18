const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  try {
    const setting = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    if (!setting || !setting.setting_value) return null;
    const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
    const id = Number(val?.id_academic_periods);
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

async function getMy({ id_user, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return null;
  return prisma.academic_grades.findUnique({
    where: { module_id_user_id_academic_periods: { module: 'english', id_user, id_academic_periods: id_ap } },
    select: { grade_id: true, id_user: true, id_academic_periods: true, score: true, status: true, validated_by: true, validated_at: true },
  }).then(r => r ? { id: r.grade_id, id_user: r.id_user, id_academic_periods: r.id_academic_periods, score: r.score, status: r.status, validated_by: r.validated_by, validated_at: r.validated_at } : null);
}

async function saveMy({ id_user, academicPeriodId, score }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e = new Error("No hay período activo configurado"); e.status = 400; throw e; }
  return prisma.academic_grades.upsert({
    where: { module_id_user_id_academic_periods: { module: 'english', id_user, id_academic_periods: id_ap } },
    create: { module: 'english', id_user, id_academic_periods: id_ap, score, status: "saved" },
    update: { score, status: "saved" },
    select: { grade_id: true, id_user: true, id_academic_periods: true, score: true, status: true },
  }).then(r => ({ id: r.grade_id, id_user: r.id_user, id_academic_periods: r.id_academic_periods, score: r.score, status: r.status }));
}

async function validate({ id, validatorId }) {
  return prisma.academic_grades.update({
    where: { grade_id: id },
    data: { status: "validated", validated_by: validatorId, validated_at: new Date() },
    select: { grade_id: true, status: true, validated_by: true, validated_at: true },
  }).then(r => ({ id: r.grade_id, status: r.status, validated_by: r.validated_by, validated_at: r.validated_at }));
}

async function listEligible({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  // Estudiantes con Tesorería aprobada en el período
  const pv = await prisma.procesos_validaciones.findMany({
    where: { proceso: 'tesoreria_aranceles', periodo_id: id_ap, estado: 'approved' },
    select: { estudiante_id: true }
  });
  const ids = Array.from(new Set(pv.map(p => p.estudiante_id))).filter(x => Number.isFinite(Number(x)));
  if (!ids.length) return [];
  const users = await prisma.usuarios.findMany({
    where: { usuario_id: { in: ids } },
    select: { usuario_id: true, nombre: true, apellido: true }
  });
  // traer nota existente si la hay
  const grades = await prisma.academic_grades.findMany({
    where: { module: 'english', id_user: { in: ids }, id_academic_periods: id_ap },
    select: { grade_id: true, id_user: true, score: true, status: true }
  });
  const gmap = new Map(grades.map(g => [g.id_user, { id: g.grade_id, score: g.score, status: g.status }]));
  return users.map(u => {
    const g = gmap.get(u.usuario_id);
    return {
      id_user: u.usuario_id,
      fullname: `${u.nombre} ${u.apellido}`.trim(),
      score: g?.score ?? null,
      status: g?.status ?? null,
      grade_id: g?.id ?? null,
    };
  }).sort((a,b)=> a.fullname.localeCompare(b.fullname));
}

async function saveFor({ target_user_id, academicPeriodId, score }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e = new Error("No hay período activo configurado"); e.status = 400; throw e; }
  return prisma.academic_grades.upsert({
    where: { module_id_user_id_academic_periods: { module: 'english', id_user: Number(target_user_id), id_academic_periods: id_ap } },
    create: { module: 'english', id_user: Number(target_user_id), id_academic_periods: id_ap, score, status: 'saved' },
    update: { score, status: 'saved' },
    select: { grade_id: true, id_user: true, score: true, status: true }
  }).then(r => ({ id: r.grade_id, id_user: r.id_user, score: r.score, status: r.status }));
}

module.exports = { getMy, saveMy, validate, listEligible, saveFor };
