const usersService = require("../services/usersService");
const { z } = require("zod");

const userCreateSchema = z.object({
  firstname: z.string().min(1, { message: "firstname requerido" }),
  lastname: z.string().min(1, { message: "lastname requerido" }),
  email: z.string().email({ message: "email inválido" }),
  password: z.string().min(6, { message: "password debe tener al menos 6 caracteres" }),
  id_rol: z.coerce.number().int({ message: "id_rol debe ser entero" }),
  is_active: z.coerce.boolean().optional(),
});

const userUpdateSchema = z.object({
  firstname: z.string().min(1).optional(),
  lastname: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  id_rol: z.coerce.number().int().optional(),
  is_active: z.coerce.boolean().optional(),
});

async function list(req, res, next) {
  try {
    const users = await usersService.listUsers(req.query);
    res.json(users);
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
    const user = await usersService.getUserById(id);
    if (!user) {
      const error = new Error("Usuario no encontrado");
      error.status = 404;
      throw error;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const payload = userCreateSchema.parse(req.body || {});
    const created = await usersService.createUser(payload);
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === "P2002") {
      err.status = 409;
      err.message = "El email ya está en uso";
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
    const payload = userUpdateSchema.parse(req.body || {});
    const updated = await usersService.updateUser(id, payload);
    res.json(updated);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === "P2002") {
      err.status = 409;
      err.message = "El email ya está en uso";
    }
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Usuario no encontrado";
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
    const deleted = await usersService.softDeleteUser(id);
    res.json({ ok: true, user: deleted });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Usuario no encontrado";
    }
    next(err);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
};
