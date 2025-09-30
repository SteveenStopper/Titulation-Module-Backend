const prisma = require("../../prisma/client");

function toInt(val, def) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function sanitizeInternshipType(val) {
  if (!val) return undefined;
  const allowed = ["Pre_profesional", "Vinculacion", "Pasantia", "Otro"];
  return allowed.includes(val) ? val : undefined;
}

function toDecimal(val) {
  if (val === undefined || val === null) return undefined;
  const num = Number(val);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

async function listInternships(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;

  const type = sanitizeInternshipType(query.type);
  const id_user = query.id_user !== undefined ? Number(query.id_user) : undefined;

  const where = {
    ...(type ? { type } : {}),
    ...(Number.isFinite(id_user) ? { id_user } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.internships_practice.count({ where }),
    prisma.internships_practice.findMany({
      where,
      orderBy: { id_internship_practice: "desc" },
      skip,
      take: pageSize,
      select: {
        id_internship_practice: true,
        type: true,
        notes: true,
        id_user: true,
        users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
      },
    }),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getInternshipById(id) {
  return prisma.internships_practice.findUnique({
    where: { id_internship_practice: id },
    select: {
      id_internship_practice: true,
      type: true,
      notes: true,
      id_user: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
    },
  });
}

async function createInternship(payload) {
  const { type, notes, id_user } = payload;
  const sanitizedType = sanitizeInternshipType(type);
  if (!sanitizedType || typeof id_user !== "number") {
    const err = new Error(
      "Campos requeridos: type (enum válido), id_user (number). notes (decimal) opcional"
    );
    err.status = 400;
    throw err;
  }
  const notesVal = toDecimal(notes);
  return prisma.internships_practice.create({
    data: { type: sanitizedType, notes: notesVal, id_user },
    select: {
      id_internship_practice: true,
      type: true,
      notes: true,
      id_user: true,
    },
  });
}

async function updateInternship(id, payload) {
  const data = {};
  if (payload.type !== undefined) {
    const s = sanitizeInternshipType(payload.type);
    if (!s) {
      const err = new Error("type inválido. Permitidos: Pre_profesional, Vinculacion, Pasantia, Otro");
      err.status = 400;
      throw err;
    }
    data.type = s;
  }
  if (payload.notes !== undefined) data.notes = toDecimal(payload.notes);
  if (payload.id_user !== undefined) data.id_user = Number(payload.id_user);

  return prisma.internships_practice.update({
    where: { id_internship_practice: id },
    data,
    select: {
      id_internship_practice: true,
      type: true,
      notes: true,
      id_user: true,
    },
  });
}

async function deleteInternship(id) {
  return prisma.internships_practice.delete({
    where: { id_internship_practice: id },
    select: { id_internship_practice: true },
  });
}

module.exports = {
  listInternships,
  getInternshipById,
  createInternship,
  updateInternship,
  deleteInternship,
};
