const rolesService = require("../services/rolesService");

async function list(req, res, next) {
  try {
    const roles = await rolesService.listRoles(req.query);
    res.json(roles);
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
    const role = await rolesService.getRoleById(id);
    if (!role) {
      const error = new Error("Rol no encontrado");
      error.status = 404;
      throw error;
    }
    res.json(role);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const created = await rolesService.createRole(req.body);
    res.status(201).json(created);
  } catch (err) {
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
    const updated = await rolesService.updateRole(id, req.body);
    res.json(updated);
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Rol no encontrado";
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
    const deleted = await rolesService.softDeleteRole(id);
    res.json({ ok: true, role: deleted });
  } catch (err) {
    if (err.code === "P2025") {
      err.status = 404;
      err.message = "Rol no encontrado";
    }
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
