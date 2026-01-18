const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  const s = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!s || !s.setting_value) return null;
  const v = typeof s.setting_value === "string" ? JSON.parse(s.setting_value) : s.setting_value;
  return v?.id_academic_periods ?? null;
}

async function listAssignments({ academicPeriodId, studentId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  const where = {
    id_academic_periods: Number(id_ap),
    ...(studentId ? { id_user_student: studentId } : {}),
  };
  return prisma.tribunal_assignments.findMany({
    where,
    orderBy: { created_at: "desc" },
    select: { id: true, id_user_student: true, id_academic_periods: true, id_president: true, id_secretary: true, id_vocal: true, defense_date: true,
      users_tribunal_assignments_id_user_studentTousers: { select: { id_user: true, firstname: true, lastname: true } },
      users_tribunal_assignments_id_presidentTousers: { select: { id_user: true, firstname: true, lastname: true } },
      users_tribunal_assignments_id_secretaryTousers: { select: { id_user: true, firstname: true, lastname: true } },
      users_tribunal_assignments_id_vocalTousers: { select: { id_user: true, firstname: true, lastname: true } },
    },
  });
}

async function createAssignment({ id_user_student, id_president, id_secretary, id_vocal, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }

  // No permitir duplicar tribunal para el mismo estudiante en el mismo período
  const existing = await prisma.tribunal_assignments.findFirst({
    where: { id_academic_periods: Number(id_ap), id_user_student: Number(id_user_student) },
    select: { id: true }
  });
  if (existing?.id) {
    const e = new Error('El estudiante ya tiene tribunal asignado en este período');
    e.status = 400;
    throw e;
  }

  // Regla UIC: el tutor no puede ser miembro del tribunal
  try {
    const asign = await prisma.uic_asignaciones.findFirst({
      where: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) },
      select: { tutor_usuario_id: true }
    });
    const tutorId = asign?.tutor_usuario_id != null ? Number(asign.tutor_usuario_id) : null;
    if (tutorId && [id_president, id_secretary, id_vocal].some(x => Number(x) === tutorId)) {
      const e = new Error('El tutor asignado no puede formar parte del tribunal');
      e.status = 400;
      throw e;
    }
  } catch (err) {
    if (err?.status) throw err;
    // si falla la consulta, no bloquear aquí; otras validaciones siguen
  }

  return prisma.tribunal_assignments.create({
    data: { id_user_student, id_academic_periods: id_ap, id_president, id_secretary, id_vocal },
    select: { id: true, id_user_student: true, id_academic_periods: true, id_president: true, id_secretary: true, id_vocal: true },
  });
}

async function updateAssignment(id, data) {
  return prisma.tribunal_assignments.update({
    where: { id },
    data,
    select: { id: true, id_user_student: true, id_academic_periods: true, id_president: true, id_secretary: true, id_vocal: true, defense_date: true, updated_at: true },
  });
}

async function scheduleDefense({ id_user_student, scheduled_at, location, academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }
  const defense = await prisma.defenses.create({
    data: { id_user_student, id_academic_periods: id_ap, scheduled_at: new Date(scheduled_at), location: location ?? null },
    select: { id_defense: true, id_user_student: true, id_academic_periods: true, scheduled_at: true, location: true }
  });
  return defense;
}

async function listDefenses({ academicPeriodId, studentId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  const where = {
    id_academic_periods: Number(id_ap),
    ...(studentId ? { id_user_student: studentId } : {}),
  };
  return prisma.defenses.findMany({
    where,
    orderBy: { scheduled_at: "desc" },
    select: { id_defense: true, id_user_student: true, id_academic_periods: true, scheduled_at: true, location: true,
      defense_grades: { select: { id: true, id_judge: true, score: true, observation: true, graded_at: true } }
    },
  });
}

async function submitDefenseGrade({ id_defense, id_judge, score, observation }) {
  return prisma.defense_grades.upsert({
    where: { id_defense_id_judge: { id_defense, id_judge } },
    update: { score, observation: observation ?? null, graded_at: new Date() },
    create: { id_defense, id_judge, score, observation: observation ?? null },
    select: { id: true, id_defense: true, id_judge: true, score: true, observation: true, graded_at: true },
  });
}

module.exports = { listAssignments, createAssignment, updateAssignment, scheduleDefense, listDefenses, submitDefenseGrade };
