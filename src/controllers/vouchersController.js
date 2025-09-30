const vouchersService = require("../services/vouchersService");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");

function toAbsoluteUploadPath(relPath) {
  if (!relPath) return null;
  const cleaned = relPath.replace(/^[/\\]+/, "");
  return path.join(process.cwd(), cleaned);
}

function removeFileSafe(relOrAbsPath) {
  try {
    const abs = path.isAbsolute(relOrAbsPath)
      ? relOrAbsPath
      : toAbsoluteUploadPath(relOrAbsPath);
    if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) {
    // noop
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function moveFileSafe(oldRelPath, newRelPath) {
  const oldAbs = toAbsoluteUploadPath(oldRelPath);
  const newAbs = toAbsoluteUploadPath(newRelPath);
  ensureDir(path.dirname(newAbs));
  fs.renameSync(oldAbs, newAbs);
}

async function list(req, res, next) {
  try {
    const result = await vouchersService.listVouchers(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      const error = new Error("ID inválido");
      error.status = 400;
      throw error;
    }
    const voucher = await vouchersService.getVoucherById(id);
    if (!voucher) {
      const error = new Error("Voucher no encontrado");
      error.status = 404;
      throw error;
    }
    res.json(voucher);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const createSchema = z.object({
      v_type: z.enum(["pago_matricula", "pago_titulacion", "pago_certificado", "pago_acta_grado", "otro"], { message: "v_type inválido" }),
      id_user: z.coerce.number().int({ message: "id_user debe ser entero" }),
      amount: z.coerce.number().optional(),
      reference: z.string().optional(),
      description: z.string().optional(),
    });
    const parsed = createSchema.parse(req.body || {});
    const payload = { ...parsed };
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      const rel = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.vouchers = rel; // guardar ruta del archivo subido
    }
    const created = await vouchersService.createVoucher(payload);
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    // rollback del archivo subido si la creación falla
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      const rel = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      removeFileSafe(rel);
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      const error = new Error("ID inválido");
      error.status = 400;
      throw error;
    }
    const updateSchema = z.object({
      v_type: z.enum(["pago_matricula", "pago_titulacion", "pago_certificado", "pago_acta_grado", "otro"]).optional(),
      id_user: z.coerce.number().int().optional(),
      amount: z.coerce.number().optional(),
      reference: z.string().optional(),
      description: z.string().optional(),
    });
    const parsed = updateSchema.parse(req.body || {});
    const payload = { ...parsed };
    let newRelPath = null;
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      newRelPath = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.vouchers = newRelPath;
    }

    // Si hay archivo nuevo, obtener el registro actual para conocer el archivo previo
    let oldRelPath = null;
    const current = await vouchersService.getVoucherById(id);
    if (!current) {
      if (newRelPath) removeFileSafe(newRelPath);
      const error = new Error("Voucher no encontrado");
      error.status = 404;
      throw error;
    }
    if (newRelPath) {
      oldRelPath = current.vouchers || null;
    }

    // Si no hay archivo nuevo pero hay cambio de id_user, mover archivo existente a nueva subcarpeta
    let movedTemp = null;
    if (!newRelPath && payload.id_user !== undefined && current.vouchers) {
      const newUserId = Number(payload.id_user);
      if (Number.isFinite(newUserId) && newUserId !== current.id_user) {
        const filename = path.basename(current.vouchers);
        const targetRel = path.join("uploads", "vouchers", String(newUserId), filename).replace(/\\/g, "/");
        try {
          moveFileSafe(current.vouchers, targetRel);
          movedTemp = { from: current.vouchers, to: targetRel };
          payload.vouchers = targetRel;
        } catch (e) {
          const err = new Error("No se pudo mover el archivo del voucher al nuevo usuario");
          err.status = 500;
          throw err;
        }
      }
    }
    let updated;
    try {
      updated = await vouchersService.updateVoucher(id, payload);
    } catch (e) {
      if (newRelPath) removeFileSafe(newRelPath);
      if (movedTemp) {
        try { moveFileSafe(movedTemp.to, movedTemp.from); } catch (_) {}
      }
      throw e;
    }

    if (newRelPath && oldRelPath && newRelPath !== oldRelPath) {
      removeFileSafe(oldRelPath);
    }
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Voucher no encontrado";
    }
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      const error = new Error("ID inválido");
      error.status = 400;
      throw error;
    }
    const removed = await vouchersService.deleteVoucher(id);
    if (removed && removed.vouchers) {
      removeFileSafe(removed.vouchers);
    }
    res.json({ ok: true, voucher: removed });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Voucher no encontrado";
    }
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
