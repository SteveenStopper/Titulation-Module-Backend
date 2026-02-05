const prisma = require("../../prisma/client");

function hasTribunalAssignmentsModel() {
  return Boolean(prisma?.tribunal_assignments && typeof prisma.tribunal_assignments.findMany === 'function');
}

async function getActivePeriodId() {
  const s = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
  if (!s || !s.setting_value) return null;
  const v = typeof s.setting_value === "string" ? JSON.parse(s.setting_value) : s.setting_value;
  return v?.id_academic_periods ?? null;
}

async function listAssignments({ academicPeriodId, studentId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return [];
  if (hasTribunalAssignmentsModel()) {
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
        users_tribunal_assignments_id_vocalTousuarios: { select: { id_user: true, firstname: true, lastname: true } },
      },
    });
  }

  // Fallback (UIC): obtener tribunal desde uic_asignaciones + uic_tribunal_miembros
  const whereAsign = {
    periodo_id: Number(id_ap),
    ...(Number.isFinite(Number(studentId)) ? { estudiante_id: Number(studentId) } : {}),
  };
  const uicAsigns = await prisma.uic_asignaciones.findMany({
    where: whereAsign,
    select: { uic_asignacion_id: true, estudiante_id: true }
  }).catch(() => []);
  if (!uicAsigns.length) return [];
  const asignIds = Array.from(new Set(uicAsigns.map(a => Number(a.uic_asignacion_id)).filter(n => Number.isFinite(n))));
  if (!asignIds.length) return [];

  const miembros = await prisma.uic_tribunal_miembros.findMany({
    where: { uic_asignacion_id: { in: asignIds } },
    select: { uic_asignacion_id: true, docente_usuario_id: true, rol_tribunal: true }
  }).catch(() => []);
  if (!miembros.length) return [];

  const miembrosByAsign = new Map();
  for (const m of miembros) {
    const aid = Number(m.uic_asignacion_id);
    if (!Number.isFinite(aid)) continue;
    const arr = miembrosByAsign.get(aid) || [];
    arr.push({ docente_usuario_id: Number(m.docente_usuario_id), rol_tribunal: String(m.rol_tribunal) });
    miembrosByAsign.set(aid, arr);
  }

  const userIds = Array.from(new Set([
    ...uicAsigns.map(a => Number(a.estudiante_id)),
    ...miembros.map(m => Number(m.docente_usuario_id)),
  ].filter(n => Number.isFinite(Number(n)))));
  const usuarios = await prisma.usuarios.findMany({
    where: { usuario_id: { in: userIds } },
    select: { usuario_id: true, nombre: true, apellido: true }
  }).catch(() => []);
  const nameMap = new Map((usuarios || []).map(u => [Number(u.usuario_id), `${u.nombre} ${u.apellido}`.trim()]));

  const data = [];
  for (const a of uicAsigns) {
    const aid = Number(a.uic_asignacion_id);
    const arr = miembrosByAsign.get(aid) || [];
    if (!arr.length) continue;
    const m1 = arr.find(x => String(x.rol_tribunal) === 'miembro_1');
    const m2 = arr.find(x => String(x.rol_tribunal) === 'miembro_2');
    const m3 = arr.find(x => String(x.rol_tribunal) === 'miembro_3');
    data.push({
      id: aid,
      id_user_student: Number(a.estudiante_id),
      id_academic_periods: Number(id_ap),
      id_president: m1?.docente_usuario_id != null ? Number(m1.docente_usuario_id) : null,
      id_secretary: m2?.docente_usuario_id != null ? Number(m2.docente_usuario_id) : null,
      id_vocal: m3?.docente_usuario_id != null ? Number(m3.docente_usuario_id) : null,
      defense_date: null,
      user_student_name: nameMap.get(Number(a.estudiante_id)) || null,
      president_name: m1?.docente_usuario_id ? (nameMap.get(Number(m1.docente_usuario_id)) || null) : null,
      secretary_name: m2?.docente_usuario_id ? (nameMap.get(Number(m2.docente_usuario_id)) || null) : null,
      vocal_name: m3?.docente_usuario_id ? (nameMap.get(Number(m3.docente_usuario_id)) || null) : null,
    });
  }
  return data;
}

async function createAssignment({ id_user_student, id_president, id_secretary, id_vocal, academicPeriodId, careerId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) { const e=new Error("No hay período activo configurado"); e.status=400; throw e; }

  // Upsert de asignación UIC para obtener uic_asignacion_id (y carrera_id)
  const existingAsign = await prisma.uic_asignaciones.findUnique({
    where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
    select: { uic_asignacion_id: true, carrera_id: true, tutor_usuario_id: true }
  }).catch(() => null);

  const resolvedCareerId = Number.isFinite(Number(careerId))
    ? Number(careerId)
    : (existingAsign?.carrera_id != null ? Number(existingAsign.carrera_id) : null);

  if (!Number.isFinite(Number(resolvedCareerId))) {
    const e = new Error('No se pudo determinar la carrera del estudiante para este período. Seleccione una carrera.');
    e.status = 400;
    throw e;
  }

  const asign = await prisma.uic_asignaciones.upsert({
    where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student) } },
    update: { carrera_id: Number(resolvedCareerId) },
    create: { periodo_id: Number(id_ap), estudiante_id: Number(id_user_student), carrera_id: Number(resolvedCareerId) },
    select: { uic_asignacion_id: true, tutor_usuario_id: true }
  });

  // No permitir duplicar tribunal: si ya hay miembros, bloquear
  const existingMembers = await prisma.uic_tribunal_miembros.findMany({
    where: { uic_asignacion_id: Number(asign.uic_asignacion_id) },
    select: { uic_tribunal_miembro_id: true }
  }).catch(() => []);
  if (Array.isArray(existingMembers) && existingMembers.length > 0) {
    const e = new Error('El estudiante ya tiene tribunal asignado en este período');
    e.status = 400;
    throw e;
  }

  // Regla UIC: el tutor no puede ser miembro del tribunal
  const tutorId = asign?.tutor_usuario_id != null ? Number(asign.tutor_usuario_id) : null;
  if (tutorId && [id_president, id_secretary, id_vocal].some(x => Number(x) === tutorId)) {
    const e = new Error('El tutor asignado no puede formar parte del tribunal');
    e.status = 400;
    throw e;
  }

  await prisma.uic_tribunal_miembros.createMany({
    data: [
      { uic_asignacion_id: Number(asign.uic_asignacion_id), docente_usuario_id: Number(id_president), rol_tribunal: 'miembro_1' },
      { uic_asignacion_id: Number(asign.uic_asignacion_id), docente_usuario_id: Number(id_secretary), rol_tribunal: 'miembro_2' },
      { uic_asignacion_id: Number(asign.uic_asignacion_id), docente_usuario_id: Number(id_vocal), rol_tribunal: 'miembro_3' },
    ],
    skipDuplicates: true,
  });

  // Respuesta compatible con controller/UI (entity_id)
  return {
    id: Number(asign.uic_asignacion_id),
    id_user_student: Number(id_user_student),
    id_academic_periods: Number(id_ap),
    id_president: Number(id_president),
    id_secretary: Number(id_secretary),
    id_vocal: Number(id_vocal),
  };
}

async function updateAssignment(id, data) {
  if (hasTribunalAssignmentsModel()) {
    return prisma.tribunal_assignments.update({
      where: { id },
      data,
      select: { id: true, id_user_student: true, id_academic_periods: true, id_president: true, id_secretary: true, id_vocal: true, defense_date: true, updated_at: true },
    });
  }

  const allowed = {
    id_president: data?.id_president,
    id_secretary: data?.id_secretary,
    id_vocal: data?.id_vocal,
    defense_date: data?.defense_date,
    id_user_student: data?.id_user_student,
  };

  if (allowed.defense_date instanceof Date && !Number.isNaN(allowed.defense_date.getTime())) {
    const e = new Error('defense_date no está disponible en el almacenamiento UIC');
    e.status = 400;
    throw e;
  }

  const asignId = Number(id);
  if (!Number.isFinite(asignId)) {
    const e = new Error('ID inválido');
    e.status = 400;
    throw e;
  }

  const rolesToUpdate = [
    { key: 'id_president', rol: 'miembro_1', val: allowed.id_president },
    { key: 'id_secretary', rol: 'miembro_2', val: allowed.id_secretary },
    { key: 'id_vocal', rol: 'miembro_3', val: allowed.id_vocal },
  ];

  for (const r of rolesToUpdate) {
    if (!Number.isFinite(Number(r.val))) continue;
    const existing = await prisma.uic_tribunal_miembros.findFirst({
      where: { uic_asignacion_id: asignId, rol_tribunal: r.rol },
      select: { uic_tribunal_miembro_id: true }
    }).catch(() => null);
    if (existing?.uic_tribunal_miembro_id) {
      await prisma.uic_tribunal_miembros.update({
        where: { uic_tribunal_miembro_id: Number(existing.uic_tribunal_miembro_id) },
        data: { docente_usuario_id: Number(r.val) },
        select: { uic_tribunal_miembro_id: true }
      }).catch(() => null);
    } else {
      await prisma.uic_tribunal_miembros.create({
        data: { uic_asignacion_id: asignId, docente_usuario_id: Number(r.val), rol_tribunal: r.rol },
        select: { uic_tribunal_miembro_id: true }
      }).catch(() => null);
    }
  }

  const asign = await prisma.uic_asignaciones.findUnique({
    where: { uic_asignacion_id: asignId },
    select: { estudiante_id: true, periodo_id: true }
  }).catch(() => null);
  if (!asign) return null;

  const miembros = await prisma.uic_tribunal_miembros.findMany({
    where: { uic_asignacion_id: asignId },
    select: { docente_usuario_id: true, rol_tribunal: true }
  }).catch(() => []);

  const m1 = (miembros || []).find(x => String(x.rol_tribunal) === 'miembro_1');
  const m2 = (miembros || []).find(x => String(x.rol_tribunal) === 'miembro_2');
  const m3 = (miembros || []).find(x => String(x.rol_tribunal) === 'miembro_3');

  return {
    id: asignId,
    id_user_student: Number(asign.estudiante_id),
    id_academic_periods: Number(asign.periodo_id),
    id_president: m1?.docente_usuario_id != null ? Number(m1.docente_usuario_id) : null,
    id_secretary: m2?.docente_usuario_id != null ? Number(m2.docente_usuario_id) : null,
    id_vocal: m3?.docente_usuario_id != null ? Number(m3.docente_usuario_id) : null,
    defense_date: null,
    updated_at: new Date(),
  };
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
