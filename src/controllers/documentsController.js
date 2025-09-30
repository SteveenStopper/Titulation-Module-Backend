const documentsService = require("../services/documentsService");
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
    const result = await documentsService.listDocuments(req.query);
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
    const doc = await documentsService.getDocumentById(id);
    if (!doc) {
      const error = new Error("Documento no encontrado");
      error.status = 404;
      throw error;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const createSchema = z.object({
      doc_type: z.enum(["solicitud", "oficio", "informe_final", "acta", "otro"], {
        message: "doc_type inválido",
      }),
      id_user: z.coerce.number().int({ message: "id_user debe ser entero" }),
      upload_date: z.string().datetime().optional(),
    });
    const parsed = createSchema.parse(req.body || {});
    const payload = { ...parsed };
    if (req.file && req.file.path) {
      // Guardar ruta relativa a partir de /uploads para no acoplar al path absoluto
      const idx = req.file.path.lastIndexOf("uploads");
      payload.file_path = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
    }
    const created = await documentsService.createDocument(payload);
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
      doc_type: z.enum(["solicitud", "oficio", "informe_final", "acta", "otro"]).optional(),
      id_user: z.coerce.number().int().optional(),
      upload_date: z.string().datetime().optional(),
      file_path: z.string().optional(),
    });
    const parsed = updateSchema.parse(req.body || {});
    const payload = { ...parsed };
    let newRelPath = null;
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      newRelPath = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.file_path = newRelPath;
    }

    // Si hay archivo nuevo, obtenemos el documento actual para eliminar el archivo viejo tras actualizar
    let oldRelPath = null;
    const current = await documentsService.getDocumentById(id);
    if (!current) {
      if (newRelPath) removeFileSafe(newRelPath);
      const error = new Error("Documento no encontrado");
      error.status = 404;
      throw error;
    }
    if (newRelPath) {
      oldRelPath = current.file_path || null;
    }

    // Si no hay archivo nuevo pero hay cambio de id_user, mover archivo existente a nueva subcarpeta
    let movedTemp = null;
    if (!newRelPath && payload.id_user !== undefined && current.file_path) {
      const newUserId = Number(payload.id_user);
      if (Number.isFinite(newUserId) && newUserId !== current.id_user) {
        const filename = path.basename(current.file_path);
        const targetRel = path.join("uploads", "documents", String(newUserId), filename).replace(/\\/g, "/");
        try {
          moveFileSafe(current.file_path, targetRel);
          movedTemp = { from: current.file_path, to: targetRel };
          payload.file_path = targetRel;
        } catch (e) {
          const err = new Error("No se pudo mover el archivo al nuevo usuario");
          err.status = 500;
          throw err;
        }
      }
    }

    let updated;
    try {
      updated = await documentsService.updateDocument(id, payload);
    } catch (e) {
      // fallo la actualización: si subimos archivo nuevo, eliminarlo (rollback)
      if (newRelPath) removeFileSafe(newRelPath);
      // si movimos archivo por cambio de usuario, revertir
      if (movedTemp) {
        try { moveFileSafe(movedTemp.to, movedTemp.from); } catch (_) {}
      }
      throw e;
    }

    // actualización ok: eliminar archivo viejo si corresponde y es diferente
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
      err.message = "Documento no encontrado";
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
    const removed = await documentsService.deleteDocument(id);
    if (removed && removed.file_path) {
      removeFileSafe(removed.file_path);
    }
    res.json({ ok: true, document: removed });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Documento no encontrado";
    }
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
