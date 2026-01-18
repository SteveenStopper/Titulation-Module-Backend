const prisma = require("../../prisma/client");

async function listRoles() {
  return prisma.roles.findMany({
    orderBy: { rol_id: "asc" },
    select: { rol_id: true, nombre: true },
  });
}

async function getRoleById(id) {
  return prisma.roles.findUnique({
    where: { rol_id: id },
    select: { rol_id: true, nombre: true },
  });
}

async function createRole(payload) {
  const { nombre } = payload;
  if (!nombre) {
    const err = new Error("Campo requerido: nombre");
    err.status = 400;
    throw err;
  }
  return prisma.roles.create({
    data: { nombre },
    select: { rol_id: true, nombre: true },
  });
}

async function updateRole(id, payload) {
  const data = {};
  if (payload.nombre !== undefined) data.nombre = payload.nombre;
  return prisma.roles.update({
    where: { rol_id: id },
    data,
    select: { rol_id: true, nombre: true },
  });
}

async function softDeleteRole(id) {
  // Nuevo esquema sin is_active: realizar borrado duro
  return prisma.roles.delete({
    where: { rol_id: id },
    select: { rol_id: true, nombre: true },
  });
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  softDeleteRole,
};
