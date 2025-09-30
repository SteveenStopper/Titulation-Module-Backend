const path = require("path");
const prisma = require("../../prisma/client");

// Middleware para definir subcarpeta de subida por usuario
// - En POST usa req.body.id_user (requerido)
// - En PUT usa req.params.id para leer el documento y tomar su id_user
module.exports = async function setUploadDir(req, res, next) {
  try {
    const root = path.join(process.cwd(), "uploads", "documents");

    // PUT /documents/:id -> usar el id_user del documento existente
    if (req.params && req.params.id) {
      const docId = Number(req.params.id);
      if (Number.isNaN(docId)) return res.status(400).json({ error: "ID inválido" });
      const doc = await prisma.documents.findUnique({
        where: { id_document: docId },
        select: { id_user: true },
      });
      if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
      req.uploadTargetDir = path.join(root, String(doc.id_user));
      return next();
    }

    // POST /documents -> requiere id_user en el body
    const idUser = req.body && req.body.id_user !== undefined ? Number(req.body.id_user) : NaN;
    if (!Number.isFinite(idUser)) {
      return res.status(400).json({ error: "id_user es requerido y debe ser numérico" });
    }
    // Validar que el usuario exista antes de permitir la subida
    const user = await prisma.users.findUnique({
      where: { id_user: idUser },
      select: { id_user: true },
    });
    if (!user) {
      return res.status(400).json({ error: "El id_user no existe" });
    }
    req.uploadTargetDir = path.join(root, String(idUser));
    next();
  } catch (err) {
    next(err);
  }
};
