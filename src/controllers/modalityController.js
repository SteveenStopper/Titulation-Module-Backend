const modalityService = require("../services/modalityService");
const { z } = require("zod");

async function list(req, res, next) {
  try {
    const result = await modalityService.listModalities(req.query);
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
    const item = await modalityService.getModalityById(id);
    if (!item) {
      const error = new Error("Modality no encontrada");
      error.status = 404;
      throw error;
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const createSchema = z.object({
      title: z.string().min(1, { message: "title requerido" }),
      career: z.string().min(1, { message: "career requerido" }),
      professor: z.string().min(1, { message: "professor requerido" }),
      id_user: z.coerce.number().int({ message: "id_user debe ser entero" }),
    });
    const payload = createSchema.parse(req.body || {});
    const created = await modalityService.createModality(payload);
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
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
      title: z.string().min(1).optional(),
      career: z.string().min(1).optional(),
      professor: z.string().min(1).optional(),
      id_user: z.coerce.number().int().optional(),
    });
    const payload = updateSchema.parse(req.body || {});
    const updated = await modalityService.updateModality(id, payload);
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Modality no encontrada";
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
    const removed = await modalityService.deleteModality(id);
    res.json({ ok: true, modality: removed });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Modality no encontrada";
    }
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
