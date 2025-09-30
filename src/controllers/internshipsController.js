const internshipsService = require("../services/internshipsService");
const { z } = require("zod");

async function list(req, res, next) {
  try {
    const result = await internshipsService.listInternships(req.query);
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
    const item = await internshipsService.getInternshipById(id);
    if (!item) {
      const error = new Error("Internship no encontrado");
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
      type: z.enum(["Pre_profesional", "Vinculacion", "Pasantia", "Otro"], { message: "type inválido" }),
      notes: z.coerce.number().optional(),
      id_user: z.coerce.number().int({ message: "id_user debe ser entero" }),
    });
    const payload = createSchema.parse(req.body || {});
    const created = await internshipsService.createInternship(payload);
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
      type: z.enum(["Pre_profesional", "Vinculacion", "Pasantia", "Otro"]).optional(),
      notes: z.coerce.number().optional(),
      id_user: z.coerce.number().int().optional(),
    });
    const payload = updateSchema.parse(req.body || {});
    const updated = await internshipsService.updateInternship(id, payload);
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Internship no encontrado";
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
    const removed = await internshipsService.deleteInternship(id);
    res.json({ ok: true, internship: removed });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Internship no encontrado";
    }
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
