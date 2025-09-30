const prisma = require("../../prisma/client");

function toInt(val, def) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

function sanitizeDocType(val) {
  if (!val) return undefined;
  const allowed = ["solicitud", "oficio", "informe_final", "acta", "otro"];
  return allowed.includes(val) ? val : undefined;
}

async function listDocuments(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;
  const doc_type = sanitizeDocType(query.doc_type);
  const id_user = query.id_user !== undefined ? Number(query.id_user) : undefined;

  const where = {
    ...(doc_type ? { doc_type } : {}),
    ...(Number.isFinite(id_user) ? { id_user } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.documents.count({ where }),
    prisma.documents.findMany({
      where,
      orderBy: { id_document: "desc" },
      skip,
      take: pageSize,
      select: {
        id_document: true,
        doc_type: true,
        file_path: true,
        upload_date: true,
        id_user: true,
        users: {
          select: { id_user: true, firstname: true, lastname: true, email: true },
        },
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

async function getDocumentById(id) {
  return prisma.documents.findUnique({
    where: { id_document: id },
    select: {
      id_document: true,
      doc_type: true,
      file_path: true,
      upload_date: true,
      id_user: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
    },
  });
}

async function createDocument(payload) {
  const { doc_type, file_path, id_user, upload_date } = payload;
  if (!doc_type || !file_path || typeof id_user !== "number") {
    const err = new Error("Campos requeridos: doc_type, file_path, id_user (number)");
    err.status = 400;
    throw err;
  }
  const sanitizedDocType = sanitizeDocType(doc_type);
  if (!sanitizedDocType) {
    const err = new Error("doc_type inválido. Valores permitidos: solicitud, oficio, informe_final, acta, otro");
    err.status = 400;
    throw err;
  }

  return prisma.documents.create({
    data: {
      doc_type: sanitizedDocType,
      file_path,
      id_user,
      ...(upload_date ? { upload_date: new Date(upload_date) } : {}),
    },
    select: {
      id_document: true,
      doc_type: true,
      file_path: true,
      upload_date: true,
      id_user: true,
    },
  });
}

async function updateDocument(id, payload) {
  const data = {};
  if (payload.doc_type !== undefined) {
    const sanitizedDocType = sanitizeDocType(payload.doc_type);
    if (!sanitizedDocType) {
      const err = new Error("doc_type inválido. Valores permitidos: solicitud, oficio, informe_final, acta, otro");
      err.status = 400;
      throw err;
    }
    data.doc_type = sanitizedDocType;
  }
  if (payload.file_path !== undefined) data.file_path = payload.file_path;
  if (payload.id_user !== undefined) data.id_user = Number(payload.id_user);
  if (payload.upload_date !== undefined) data.upload_date = new Date(payload.upload_date);

  return prisma.documents.update({
    where: { id_document: id },
    data,
    select: {
      id_document: true,
      doc_type: true,
      file_path: true,
      upload_date: true,
      id_user: true,
    },
  });
}

async function deleteDocument(id) {
  return prisma.documents.delete({
    where: { id_document: id },
    select: { id_document: true, file_path: true },
  });
}

module.exports = {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
};
