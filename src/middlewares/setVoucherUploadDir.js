const path = require("path");
const prisma = require("../../prisma/client");

// Define subcarpeta de subida para vouchers
// - POST usa req.body.id_user (requerido, debe existir)
// - PUT usa req.params.id para leer el voucher y tomar su id_user
module.exports = async function setVoucherUploadDir(req, res, next) {
  try {
    const root = path.join(process.cwd(), "uploads", "vouchers");

    // PUT /vouchers/:id -> usar el id_user del voucher existente
    if (req.params && req.params.id) {
      const voucherId = Number(req.params.id);
      if (Number.isNaN(voucherId)) return res.status(400).json({ error: "ID inválido" });
      const voucher = await prisma.vouchers.findUnique({
        where: { id_voucher: voucherId },
        select: { id_user: true },
      });
      if (!voucher) return res.status(404).json({ error: "Voucher no encontrado" });
      req.uploadTargetDir = path.join(root, String(voucher.id_user));
      return next();
    }

    // POST /vouchers -> requiere id_user
    const idUser = req.body && req.body.id_user !== undefined ? Number(req.body.id_user) : NaN;
    if (!Number.isFinite(idUser)) {
      return res.status(400).json({ error: "id_user es requerido y debe ser numérico" });
    }
    // Validar que el usuario exista
    const user = await prisma.users.findUnique({ where: { id_user: idUser }, select: { id_user: true } });
    if (!user) return res.status(400).json({ error: "El id_user no existe" });

    req.uploadTargetDir = path.join(root, String(idUser));
    next();
  } catch (err) {
    next(err);
  }
};
