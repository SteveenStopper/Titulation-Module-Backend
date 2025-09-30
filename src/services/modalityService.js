const prisma = require("../../prisma/client");

function toInt(val, def) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function likeFilter(val) {
  if (!val || typeof val !== "string") return undefined;
  return { contains: val, mode: "insensitive" };
}

async function listModalities(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;

  const id_user = query.id_user !== undefined ? Number(query.id_user) : undefined;
  const title = likeFilter(query.title);
  const career = likeFilter(query.career);
  const professor = likeFilter(query.professor);

  const where = {
    ...(Number.isFinite(id_user) ? { id_user } : {}),
    ...(title ? { title } : {}),
    ...(career ? { career } : {}),
    ...(professor ? { professor } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.modality.count({ where }),
    prisma.modality.findMany({
      where,
      orderBy: { id_modality: "desc" },
      skip,
      take: pageSize,
      select: {
        id_modality: true,
        title: true,
        career: true,
        professor: true,
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

async function getModalityById(id) {
  return prisma.modality.findUnique({
    where: { id_modality: id },
    select: {
      id_modality: true,
      title: true,
      career: true,
      professor: true,
      id_user: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
    },
  });
}

async function createModality(payload) {
  const { title, career, professor, id_user } = payload;
  if (!title || !career || !professor || typeof id_user !== "number") {
    const err = new Error("Campos requeridos: title, career, professor, id_user (number)");
    err.status = 400;
    throw err;
  }
  return prisma.modality.create({
    data: { title, career, professor, id_user },
    select: {
      id_modality: true,
      title: true,
      career: true,
      professor: true,
      id_user: true,
    },
  });
}

async function updateModality(id, payload) {
  const data = {};
  if (payload.title !== undefined) data.title = payload.title;
  if (payload.career !== undefined) data.career = payload.career;
  if (payload.professor !== undefined) data.professor = payload.professor;
  if (payload.id_user !== undefined) data.id_user = Number(payload.id_user);

  return prisma.modality.update({
    where: { id_modality: id },
    data,
    select: {
      id_modality: true,
      title: true,
      career: true,
      professor: true,
      id_user: true,
    },
  });
}

async function deleteModality(id) {
  return prisma.modality.delete({ where: { id_modality: id }, select: { id_modality: true } });
}

module.exports = {
  listModalities,
  getModalityById,
  createModality,
  updateModality,
  deleteModality,
};
