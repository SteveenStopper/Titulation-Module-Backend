const prisma = require("../../prisma/client");

async function getActivePeriodId() {
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

function requireModality(expected) {
  return async function (req, res, next) {
    try {
      const id_user = req.user?.sub;
      const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
      // Roles administrativos no deben estar restringidos por modalidad de estudiante
      if (roles.includes('Administrador') || roles.includes('Coordinador') || roles.includes('Vicerrector') || roles.includes('Secretaria') || roles.includes('Tesoreria')) {
        return next();
      }
      if (!id_user) {
        const err = new Error("No autorizado");
        err.status = 401;
        throw err;
      }
      const activePeriodId = await getActivePeriodId();
      if (!activePeriodId) {
        const err = new Error("No hay período activo configurado");
        err.status = 400;
        throw err;
      }
      // Validar modalidad desde 'modalidades_elegidas' (schema actual) usando estudiante_id
      const mod = await prisma.modalidades_elegidas.findFirst({
        where: { periodo_id: Number(activePeriodId), estudiante_id: Number(id_user) },
        select: { modalidad: true },
      });
      if (!mod || String(mod.modalidad) !== String(expected)) {
        const err = new Error("Acceso restringido por modalidad");
        err.status = 403;
        throw err;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireModality };
