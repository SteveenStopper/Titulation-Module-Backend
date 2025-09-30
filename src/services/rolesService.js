const prisma = require("../../prisma/client");

function parseBoolean(value, def = true) {
  if (value === undefined) return def;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return def;
}

async function listRoles(query) {
  const activeOnly = parseBoolean(query.activeOnly, true);
  return prisma.roles.findMany({
    where: activeOnly ? { is_active: true } : undefined,
    orderBy: { id_rol: "asc" },
    select: { id_rol: true, rol_name: true, is_active: true },
  });
}

async function getRoleById(id) {
  return prisma.roles.findUnique({
    where: { id_rol: id },
    select: { id_rol: true, rol_name: true, is_active: true },
  });
}

async function createRole(payload) {
  const { rol_name, is_active } = payload;
  if (!rol_name) {
    const err = new Error("Campo requerido: rol_name");
    err.status = 400;
    throw err;
  }
  return prisma.roles.create({
    data: { rol_name, is_active: is_active === undefined ? true : Boolean(is_active) },
    select: { id_rol: true, rol_name: true, is_active: true },
  });
}

async function updateRole(id, payload) {
  const data = {};
  if (payload.rol_name !== undefined) data.rol_name = payload.rol_name;
  if (payload.is_active !== undefined) data.is_active = Boolean(payload.is_active);
  return prisma.roles.update({
    where: { id_rol: id },
    data,
    select: { id_rol: true, rol_name: true, is_active: true },
  });
}

async function softDeleteRole(id) {
  return prisma.roles.update({
    where: { id_rol: id },
    data: { is_active: false },
    select: { id_rol: true, rol_name: true, is_active: true },
  });
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  softDeleteRole,
};
