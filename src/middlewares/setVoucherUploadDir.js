const path = require("path");
const prisma = require("../../prisma/client");

// Define subcarpeta de subida para vouchers
// - POST usa req.body.id_user o, si no viene, req.user.sub (autenticado)
// - PUT usa req.params.id para leer el voucher y tomar su id_user
module.exports = async function setVoucherUploadDir(req, res, next) {
  try {
    const root = path.join(process.cwd(), "uploads", "vouchers");

    // PUT /vouchers/:id -> usar el usuario_id del documento existente
    if (req.params && req.params.id) {
      const voucherId = Number(req.params.id);
      if (Number.isNaN(voucherId)) return res.status(400).json({ error: "ID inválido" });
      const doc = await prisma.documentos.findUnique({
        where: { documento_id: voucherId },
        select: { usuario_id: true },
      });
      if (!doc) return res.status(404).json({ error: "Voucher no encontrado" });
      req.uploadTargetDir = path.join(root, String(doc.usuario_id));
      return next();
    }

    // POST /vouchers -> id_user del body o fallback al usuario autenticado
    let idUser = undefined;
    if (req.body && req.body.id_user !== undefined) {
      const n = Number(req.body.id_user);
      if (Number.isFinite(n)) idUser = n;
    }
    if (idUser === undefined) {
      const sub = req.user && req.user.sub !== undefined ? Number(req.user.sub) : NaN;
      if (Number.isFinite(sub)) idUser = sub;
    }
    if (!Number.isFinite(idUser)) {
      return res.status(400).json({ error: "id_user es requerido" });
    }
    // En entornos de desarrollo, no forzar existencia en DB; crear carpeta por id
    req.uploadTargetDir = path.join(root, String(idUser));
    next();
  } catch (err) {
    next(err);
  }
};
