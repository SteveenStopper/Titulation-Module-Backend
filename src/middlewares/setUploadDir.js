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
      const doc = await prisma.documentos.findUnique({
        where: { documento_id: docId },
        select: { usuario_id: true },
      });
      if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
      req.uploadTargetDir = path.join(root, String(doc.usuario_id));
      return next();
    }

    // POST /documents -> usar body.usuario_id|id_user o fallback al usuario autenticado (req.user.sub|req.user.id)
    let idUser = NaN;
    if (req.body) {
      if (req.body.usuario_id !== undefined) idUser = Number(req.body.usuario_id);
      else if (req.body.id_user !== undefined) idUser = Number(req.body.id_user);
    }
    if (!Number.isFinite(idUser)) {
      const maybeSub = req.user && req.user.sub !== undefined ? Number(req.user.sub) : NaN;
      const maybeId = req.user && req.user.id !== undefined ? Number(req.user.id) : NaN;
      if (Number.isFinite(maybeSub)) idUser = maybeSub;
      else if (Number.isFinite(maybeId)) idUser = maybeId;
    }
    if (!Number.isFinite(idUser)) {
      return res.status(400).json({ error: "id_user es requerido y debe ser numérico" });
    }
    // Validar que el usuario exista antes de permitir la subida
    const user = await prisma.usuarios.findUnique({ where: { usuario_id: idUser }, select: { usuario_id: true } });
    if (!user) {
      return res.status(400).json({ error: "El id_user no existe" });
    }
    req.uploadTargetDir = path.join(root, String(idUser));
    next();
  } catch (err) {
    next(err);
  }
};
