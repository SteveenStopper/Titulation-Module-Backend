const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!setting || !setting.setting_value) return null;
  const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
  return val?.id_academic_periods ?? null;
}

async function listMyAttendance({ id_user, academicPeriodId, courseId, from, to }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  const where = {
    id_user,
    ...(id_ap ? { id_academic_periods: id_ap } : {}),
    ...(courseId ? { id_course: courseId } : {}),
    ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  };
  return prisma.complexivo_attendance.findMany({
    where,
    orderBy: { date: "desc" },
    select: { id: true, id_user: true, id_course: true, id_academic_periods: true, date: true, present: true },
  });
}

async function addAttendance({ id_user, academicPeriodId, courseId, date, present }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }
  return prisma.complexivo_attendance.create({
    data: { id_user, id_course: courseId, id_academic_periods: id_ap, date: new Date(date), present: !!present },
    select: { id: true, id_user: true, id_course: true, id_academic_periods: true, date: true, present: true },
  });
}

async function listCourses({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  // Courses may not be tied to period in schema; filter teachers by period and then unique course, plus active courses
  const courses = await prisma.complexivo_courses.findMany({
    where: { is_active: true },
    select: { id_course: true, code: true, name: true },
  });
  return courses;
}

async function listCourseTeachers({ courseId, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  const where = { id_course: courseId, ...(id_ap ? { id_academic_periods: id_ap } : {}) };
  return prisma.complexivo_course_teachers.findMany({
    where,
    select: { id: true, users: { select: { id_user: true, firstname: true, lastname: true, email: true } } },
  });
}

async function listVeedores({ careerId, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  const where = { ...(careerId ? { id_career: careerId } : {}), ...(id_ap ? { id_academic_periods: id_ap } : {}) };
  return prisma.veedor_assignments.findMany({
    where,
    select: { id: true, id_career: true, id_academic_periods: true, users: { select: { id_user: true, firstname: true, lastname: true, email: true } } },
  });
}

module.exports = { listMyAttendance, addAttendance, listCourses, listCourseTeachers, listVeedores };
