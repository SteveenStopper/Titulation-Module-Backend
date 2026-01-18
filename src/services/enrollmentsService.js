const prisma = require("../../prisma/client");

async function getStudentCareerId(estudianteId) {
  // La carrera del estudiante vive en el esquema externo (SIGALA). Lo usamos para persistir modalidades_elegidas.carrera_id
  // para que otros módulos (UIC/Complexivo) puedan filtrar por carrera.
  const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
  const id = Number(estudianteId);
  if (!Number.isFinite(id)) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ID_CARRERA AS carrera_id FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS WHERE ID_USUARIOS = ? LIMIT 1`,
      id
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const cid = row ? Number(row.carrera_id) : null;
    return Number.isFinite(cid) ? cid : null;
  } catch (_) {
    return null;
  }
}

async function getActivePeriodId() {
  // tomar el período activo desde tabla periodos
  try {
    const per = await prisma.periodos.findFirst({
      where: { estado: 'activo' },
      orderBy: { periodo_id: 'desc' },
      select: { periodo_id: true },
    });
    return per?.periodo_id ?? null;
  } catch (_) {
    return null;
  }
}

async function selectModality({ id_user, academicPeriodId, modality }) {
  const id_academic_periods = academicPeriodId ?? (await getActivePeriodId());
  if (!id_academic_periods) {
    const err = new Error("No hay período activo configurado");
    err.status = 400;
    throw err;
  }

  const estudiante_id = Number(id_user);
  if (!Number.isFinite(estudiante_id)) { const e = new Error('Usuario inválido'); e.status = 400; throw e; }

  const periodo_id = Number(id_academic_periods);
  const carrera_id = await getStudentCareerId(estudiante_id);
  if (!Number.isFinite(Number(carrera_id))) {
    const err = new Error('No se pudo determinar la carrera del estudiante');
    err.status = 409;
    throw err;
  }

  // No existe unique compuesto, así que hacemos findFirst y luego update/create
  const existing = await prisma.modalidades_elegidas.findFirst({
    where: { periodo_id: periodo_id, estudiante_id: estudiante_id },
    select: { modalidad_elegida_id: true },
  });

  if (existing?.modalidad_elegida_id) {
    await prisma.modalidades_elegidas.update({
      where: { modalidad_elegida_id: Number(existing.modalidad_elegida_id) },
      data: { modalidad: modality },
      select: { modalidad_elegida_id: true },
    });
  } else {
    await prisma.modalidades_elegidas.create({
      data: {
        periodo_id: periodo_id,
        estudiante_id: estudiante_id,
        carrera_id: Number(carrera_id),
        modalidad: modality,
      },
      select: { modalidad_elegida_id: true },
    });
  }

  return { id: null, id_user: estudiante_id, id_academic_periods: periodo_id, modality, status: 'in_progress' };
}

async function getCurrentSelection({ id_user, academicPeriodId }) {
  const id_academic_periods = academicPeriodId ?? (await getActivePeriodId());
  if (!id_academic_periods) return null;

  const estudiante_id = Number(id_user);
  if (!Number.isFinite(estudiante_id)) return null;
  const periodo_id = Number(id_academic_periods);

  const row = await prisma.modalidades_elegidas.findFirst({
    where: { periodo_id: periodo_id, estudiante_id: estudiante_id },
    orderBy: { creado_en: 'desc' },
    select: { modalidad: true },
  });
  if (!row?.modalidad) return null;
  return { id: null, id_user: estudiante_id, id_academic_periods: periodo_id, modality: String(row.modalidad), status: 'in_progress' };
}

async function list({ status, academicPeriodId, modality }) {
  // Opción B: no existe process_enrollments; devolver lista vacía
  return [];
}

async function setStatus({ id, status }) {
  // Opción B: validar y devolver estructura simulada sin persistir
  const allowed = new Set(["approved", "rejected", "in_progress", "pending", "submitted"]);
  if (!allowed.has(status)) { const err = new Error("Estado inválido"); err.status = 400; throw err; }
  return { id: Number(id), status };
}

module.exports = { selectModality, getCurrentSelection, list, setStatus };
