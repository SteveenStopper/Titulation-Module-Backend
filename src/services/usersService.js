const prisma = require("../../prisma/client");
const { hashPassword } = require("../utils/password");

function parseBoolean(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return defaultValue;
}

async function listUsers(query) {
  const activeOnly = parseBoolean(query.activeOnly, true);
  const rows = await prisma.usuarios.findMany({
    where: activeOnly ? { activo: true } : undefined,
    orderBy: { usuario_id: "asc" },
    select: {
      usuario_id: true,
      nombre: true,
      apellido: true,
      correo: true,
      activo: true,
      creado_en: true,
    },
  });
  return rows.map(r => ({
    id_user: r.usuario_id,
    firstname: r.nombre,
    lastname: r.apellido,
    email: r.correo,
    is_active: r.activo,
    created_at: r.creado_en,
    updated_at: r.creado_en,
    id_rol: null,
  }));
}

async function getUserById(id) {
  const u = await prisma.usuarios.findUnique({
    where: { usuario_id: Number(id) },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true, creado_en: true },
  });
  if (!u) return null;
  return {
    id_user: u.usuario_id,
    firstname: u.nombre,
    lastname: u.apellido,
    email: u.correo,
    is_active: u.activo,
    created_at: u.creado_en,
    updated_at: u.creado_en,
    id_rol: null,
  };
}

async function createUser(payload) {
  const { firstname, lastname, email, password, id_rol, is_active } = payload;
  if (!firstname || !lastname || !email || !password) {
    const err = new Error("Campos requeridos: firstname, lastname, email, password");
    err.status = 400;
    throw err;
  }

  const hashed = await hashPassword(password);

  const created = await prisma.usuarios.create({
    data: {
      nombre: firstname,
      apellido: lastname,
      correo: email,
      contrase_a_hash: hashed,
      activo: is_active === undefined ? true : Boolean(is_active),
    },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true, creado_en: true },
  });
  return {
    id_user: created.usuario_id,
    firstname: created.nombre,
    lastname: created.apellido,
    email: created.correo,
    is_active: created.activo,
    created_at: created.creado_en,
    updated_at: created.creado_en,
    id_rol: null,
  };
}

async function updateUser(id, payload) {
  const { firstname, lastname, email, password, id_rol, is_active } = payload;
  const data = {};
  if (firstname !== undefined) data.nombre = firstname;
  if (lastname !== undefined) data.apellido = lastname;
  if (email !== undefined) data.correo = email;
  if (password !== undefined) data.contrase_a_hash = await hashPassword(password);
  if (is_active !== undefined) data.activo = Boolean(is_active);

  const updated = await prisma.usuarios.update({
    where: { usuario_id: Number(id) },
    data,
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true, creado_en: true },
  });
  return {
    id_user: updated.usuario_id,
    firstname: updated.nombre,
    lastname: updated.apellido,
    email: updated.correo,
    is_active: updated.activo,
    created_at: updated.creado_en,
    updated_at: updated.creado_en,
    id_rol: null,
  };
}

async function softDeleteUser(id) {
  const u = await prisma.usuarios.update({
    where: { usuario_id: Number(id) },
    data: { activo: false },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true, creado_en: true },
  });
  return {
    id_user: u.usuario_id,
    firstname: u.nombre,
    lastname: u.apellido,
    email: u.correo,
    is_active: u.activo,
    created_at: u.creado_en,
    updated_at: u.creado_en,
    id_rol: null,
  };
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  softDeleteUser,
};
