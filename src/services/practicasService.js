const prisma = require("../../prisma/client");
const vouchersService = require("./vouchersService");

async function getActivePeriodId() {
  const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!setting || !setting.setting_value) return null;
  const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
  return val?.id_academic_periods ?? null;
}

async function getPeriodDateRange(academicPeriodId) {
  const id = Number(academicPeriodId);
  if (!Number.isFinite(id)) return null;
  try {
    const per = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { fecha_inicio: true, fecha_fin: true } });
    if (!per?.fecha_inicio || !per?.fecha_fin) return null;
    const start = new Date(per.fecha_inicio);
    start.setHours(0, 0, 0, 0);
    const end = new Date(per.fecha_fin);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  } catch (_) {
    return null;
  }
}

async function listEligible({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];

  const range = await getPeriodDateRange(id_ap);
  const listPaidIds = async (useRange) => {
    const paid = await prisma.documentos.findMany({
      where: {
        tipo: 'comprobante_certificados',
        estado: 'aprobado',
        ...(useRange && range?.start && range?.end ? { creado_en: { gte: range.start, lte: range.end } } : {}),
      },
      select: { usuario_id: true },
      distinct: ['usuario_id'],
    }).catch(() => []);
    return Array.from(new Set((paid || []).map(r => r.usuario_id))).filter(x => Number.isFinite(Number(x)));
  };

  let ids = await listPaidIds(true);
  if (!ids.length) ids = await listPaidIds(false);
  const idsNum = Array.from(new Set((ids || []).map(n => Number(n)).filter(Number.isFinite)));
  if (!idsNum.length) return [];
  const users = await prisma.usuarios.findMany({
    where: { usuario_id: { in: idsNum } },
    select: { usuario_id: true, nombre: true, apellido: true }
  });
  const careerMap = await vouchersService.getCareerMapForUserIds(idsNum);
  const certRows = await prisma.documentos.findMany({
    where: { tipo: 'cert_practicas', estudiante_id: { in: idsNum.map(Number) } },
    orderBy: { documento_id: 'desc' },
    select: { documento_id: true, estudiante_id: true, ruta_archivo: true }
  }).catch(() => []);
  const certMap = new Map();
  for (const r of (certRows || [])) {
    const sid = Number(r.estudiante_id);
    if (!Number.isFinite(sid) || certMap.has(sid)) continue;
    const rel = r?.ruta_archivo ? String(r.ruta_archivo).replace(/\\/g, '/') : null;
    certMap.set(sid, { documento_id: Number(r.documento_id), url: rel ? `/uploads/${rel.replace(/^uploads\//, '')}` : null });
  }
  const grades = await prisma.academic_grades.findMany({
    where: { module: 'practicas', id_user: { in: idsNum }, id_academic_periods: id_ap },
    select: { grade_id: true, id_user: true, score: true, status: true }
  });
  const gmap = new Map(grades.map(g => [g.id_user, { id: g.grade_id, score: g.score, status: g.status }]));
  return users.map(u => {
    const g = gmap.get(u.usuario_id);
    const career = careerMap.get(Number(u.usuario_id)) || null;
    const cert = certMap.get(Number(u.usuario_id));
    return {
      id_user: u.usuario_id,
      fullname: `${u.nombre} ${u.apellido}`.trim(),
      career,
      career_name: career,
      certificate_doc_id: cert?.documento_id ?? null,
      certificate_url: cert?.url ?? null,
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
    where: { module_id_user_id_academic_periods: { module: 'practicas', id_user: Number(target_user_id), id_academic_periods: id_ap } },
    create: { module: 'practicas', id_user: Number(target_user_id), id_academic_periods: id_ap, score, status: 'saved' },
    update: { score, status: 'saved' },
    select: { grade_id: true, id_user: true, score: true, status: true }
  }).then(r => ({ id: r.grade_id, id_user: r.id_user, score: r.score, status: r.status }));
}

module.exports = { listEligible, saveFor };
