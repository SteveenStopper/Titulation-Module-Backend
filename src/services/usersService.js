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
  return prisma.users.findMany({
    where: activeOnly ? { is_active: true } : undefined,
    orderBy: { id_user: "asc" },
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      id_rol: true,
    },
  });
}

async function getUserById(id) {
  return prisma.users.findUnique({
    where: { id_user: id },
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      id_rol: true,
    },
  });
}

async function createUser(payload) {
  const { firstname, lastname, email, password, id_rol, is_active } = payload;
  if (!firstname || !lastname || !email || !password || typeof id_rol !== "number") {
    const err = new Error("Campos requeridos: firstname, lastname, email, password, id_rol (number)");
    err.status = 400;
    throw err;
  }

  const hashed = await hashPassword(password);

  return prisma.users.create({
    data: {
      firstname,
      lastname,
      email,
      password: hashed,
      id_rol,
      is_active: is_active === undefined ? true : Boolean(is_active),
    },
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      id_rol: true,
    },
  });
}

async function updateUser(id, payload) {
  const { firstname, lastname, email, password, id_rol, is_active } = payload;
  const data = {};
  if (firstname !== undefined) data.firstname = firstname;
  if (lastname !== undefined) data.lastname = lastname;
  if (email !== undefined) data.email = email;
  if (password !== undefined) data.password = await hashPassword(password);
  if (id_rol !== undefined) data.id_rol = Number(id_rol);
  if (is_active !== undefined) data.is_active = Boolean(is_active);
  data.updated_at = new Date();

  return prisma.users.update({
    where: { id_user: id },
    data,
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      id_rol: true,
    },
  });
}

async function softDeleteUser(id) {
  return prisma.users.update({
    where: { id_user: id },
    data: { is_active: false, updated_at: new Date() },
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      id_rol: true,
    },
  });
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  softDeleteUser,
};
