const prisma = require("../../prisma/client");

async function getActivePeriod() {
  try {
    const per = await prisma.periodos.findFirst({
      where: { estado: 'activo' },
      orderBy: { periodo_id: 'desc' },
      select: { periodo_id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true },
    });
    if (!per) return null;
    return {
      id_academic_periods: Number(per.periodo_id),
      name: String(per.nombre),
      date_start: per.fecha_inicio ? per.fecha_inicio.toISOString().slice(0,10) : null,
      date_end: per.fecha_fin ? per.fecha_fin.toISOString().slice(0,10) : null,
      status: per.estado || 'inactivo',
    };
  } catch (_) { return null; }
}

async function getProfile(id_user) {
  // Adaptado al esquema actual: tabla 'usuarios'
  const u = await prisma.usuarios.findUnique({
    where: { usuario_id: id_user },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true },
  });
  const user = u
    ? { id_user: u.usuario_id, firstname: u.nombre, lastname: u.apellido, email: u.correo, is_active: u.activo }
    : null;
  const ap = await getActivePeriod();
  let enrollment = null;
  try {
    if (ap?.id_academic_periods) {
      const mod = await prisma.modalidades_elegidas.findFirst({
        where: { periodo_id: Number(ap.id_academic_periods), estudiante_id: Number(id_user) },
        select: { modalidad: true },
      });
      if (mod) {
        enrollment = { id: null, modality: String(mod.modalidad), status: 'in_progress' };
      }
    }
  } catch (_) { enrollment = null; }

  // Validaciones de procesos (Tesorería/Secretaría) para el período activo
  let validations = null;
  try {
    if (ap?.id_academic_periods) {
      const rows = await prisma.procesos_validaciones.findMany({
        where: {
          periodo_id: Number(ap.id_academic_periods),
          estudiante_id: Number(id_user),
          proceso: { in: ['tesoreria_aranceles', 'secretaria_promedios'] },
        },
        select: { proceso: true, estado: true, observacion: true, actualizado_en: true },
      });
      validations = {};
      for (const r of rows || []) {
        validations[String(r.proceso)] = {
          estado: String(r.estado),
          observacion: r.observacion,
          actualizado_en: r.actualizado_en ? r.actualizado_en.toISOString() : null,
        };
      }
    }
  } catch (_) {
    validations = null;
  }

  return { user, activePeriod: ap, enrollment, validations };
}

module.exports = { getProfile };
