const vouchersService = require("../services/vouchersService");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");

function getUserId(req) {
  const u = req.user || {};
  return Number.isFinite(u.sub) ? u.sub : (Number.isFinite(u.id) ? u.id : undefined);
}

function getRoles(req) {
  const u = req.user || {};
  if (Array.isArray(u.roles)) return u.roles.map(String);
  if (u.role) return [String(u.role)];
  return [];
}

function hasAnyRole(req, allowed) {
  const roles = getRoles(req);
  if (roles.includes("Administrador") || roles.includes("Admin") || roles.includes("ADMIN")) return true;
  return roles.some(r => allowed.includes(r));
}

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
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const q = { ...req.query };
    if (!canReview) {
      const me = getUserId(req);
      q.id_user = me;
    }
    const result = await vouchersService.listVouchers(q);
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
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const me = getUserId(req);
    if (!canReview && voucher.id_user !== me) {
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
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
      id_user: z.coerce.number().int().optional(),
      amount: z.coerce.number().optional(),
      reference: z.string().optional(),
      description: z.string().optional(),
    });
    const parsed = createSchema.parse(req.body || {});
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const me = getUserId(req);
    // Para estudiantes: forzar id_user = autenticado para evitar errores por desajustes de FE
    if (!canReview) {
      parsed.id_user = Number(me);
    } else if (canReview && parsed.id_user !== me) {
      // Revisores pueden crear para otro usuario
    }
    // La columna vouchers en DB es NOT NULL: exigimos archivo en creación
    if (!req.file || !req.file.path) {
      const e = new Error("Archivo de voucher requerido");
      e.status = 400;
      throw e;
    }
    // Asegurar que id_user exista en usuarios; en dev puede venir 0 o un id inexistente
    try {
      const prisma = require("../../prisma/client");
      const exists = await prisma.usuarios.findUnique({ where: { usuario_id: Number(parsed.id_user) }, select: { usuario_id: true } });
      if (!exists) {
        // Intentar resolver por email del token
        const email = (req.user && req.user.email) ? String(req.user.email) : null;
        if (email) {
          const byEmail = await prisma.usuarios.findFirst({ where: { correo: email }, select: { usuario_id: true, nombre: true, apellido: true, correo: true } });
          if (byEmail) {
            parsed.id_user = Number(byEmail.usuario_id);
          } else {
            // Crear usuario mínimo local
            const fullName = (req.user && req.user.name) ? String(req.user.name) : '';
            const [nombre, ...rest] = fullName.split(' ');
            const apellido = rest.join(' ').trim();
            const created = await prisma.usuarios.create({
              data: { nombre: nombre || 'Estudiante', apellido: apellido || '', correo: email, activo: true },
              select: { usuario_id: true }
            });
            parsed.id_user = Number(created.usuario_id);
          }
        }
      }
    } catch (_) { /* no bloquear, se manejará por FK si falla */ }

    const payload = { ...parsed };
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      const rel = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.vouchers = rel; // guardar ruta del archivo subido
    }
    const created = await vouchersService.createVoucher(payload);
    // Notificar a Tesorería que llegó un nuevo comprobante
    try {
      const notifications = require("../services/notificationsService");
      await notifications.notifyRoles({
        roles: ['Tesoreria'],
        type: 'pago_nuevo',
        title: 'Nuevo comprobante recibido',
        message: `Voucher de ${payload.v_type || 'pago'} enviado por usuario ${payload.id_user}`,
        entity_type: 'voucher',
        entity_id: Number(created?.id_voucher || 0),
      });
      // Pagos Inglés/Vinculación: si es pago_certificado, notificar a ambos roles de revisión
      if ((payload.v_type || payload.voucher_type) === 'pago_certificado') {
        await notifications.notifyRoles({
          roles: ['Ingles','Vinculacion_Practicas'],
          type: 'pago_certificado_nuevo',
          title: 'Nuevo pago de certificado',
          message: `Usuario ${payload.id_user} subió comprobante de certificado`,
          entity_type: 'voucher',
          entity_id: Number(created?.id_voucher || 0),
        });
      }
    } catch (_) { /* no bloquear */ }
    res.status(201).json(created);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    if (err.code === 'P2003') {
      err.status = 400;
      err.message = 'id_user no existe en la base de datos';
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
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const me = getUserId(req);
    if (!canReview && current.id_user !== me) {
      if (newRelPath) removeFileSafe(newRelPath);
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
    }
    if (!canReview && payload.id_user !== undefined && payload.id_user !== me) {
      if (newRelPath) removeFileSafe(newRelPath);
      const e = new Error("No autorizado: no puede reasignar dueño");
      e.status = 403;
      throw e;
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
    const current = await vouchersService.getVoucherById(id);
    if (!current) {
      const error = new Error("Voucher no encontrado");
      error.status = 404;
      throw error;
    }
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const me = getUserId(req);
    if (!canReview && current.id_user !== me) {
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
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

async function download(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { const e=new Error("ID inválido"); e.status=400; throw e; }
    const voucher = await vouchersService.getVoucherById(id);
    if (!voucher) { const e=new Error("Voucher no encontrado"); e.status=404; throw e; }
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Coordinador"]);
    const me = getUserId(req);
    if (!canReview && voucher.id_user !== me) { const e=new Error("No autorizado: dueño requerido"); e.status=403; throw e; }
    const rel = voucher.vouchers; // ruta almacenada
    if (!rel) { const e=new Error("Archivo no disponible"); e.status=404; throw e; }
    const abs = toAbsoluteUploadPath(rel);
    if (!fs.existsSync(abs)) { const e=new Error("Archivo no encontrado en almacenamiento"); e.status=404; throw e; }
    res.setHeader("Content-Type", "application/octet-stream");
    const fname = `voucher_${id}`;
    res.setHeader("Content-Disposition", `inline; filename=\"${fname}\"`);
    fs.createReadStream(abs).pipe(res);
  } catch (err) { next(err); }
}

const notifications = require("../services/notificationsService");

async function approve(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { const e=new Error("ID inválido"); e.status=400; throw e; }
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Administrador"]);
    if (!canReview) { const e=new Error("No autorizado"); e.status=403; throw e; }
    // Pre-cargar voucher para conocer el tipo
    const current = await vouchersService.getVoucherById(id);
    const updated = await vouchersService.setStatus(id, 'approved');
    // Notificar al dueño del voucher
    try {
      if (updated?.id_user) {
        await notifications.create({
          id_user: Number(updated.id_user),
          type: 'tesoreria_aprobado',
          title: 'Tesorería: Comprobante aprobado',
          message: 'Tu comprobante fue aprobado',
          entity_type: 'voucher',
          entity_id: Number(id),
        });
      }
      // Si es pago de certificado, notificar también a Inglés y Vinculación
      if (current?.voucher_type === 'pago_certificado') {
        await notifications.notifyRoles({
          roles: ['Ingles','Vinculacion_Practicas'],
          type: 'pago_certificado_aprobado',
          title: 'Pago de certificado aprobado',
          message: `Voucher ${id} aprobado`,
          entity_type: 'voucher',
          entity_id: Number(id),
        });
      }
    } catch (_) { /* no bloquear */ }
    res.json(updated);
  } catch (err) { next(err); }
}

async function reject(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { const e=new Error("ID inválido"); e.status=400; throw e; }
    const canReview = hasAnyRole(req, ["Secretaria", "Tesoreria", "Administrador"]);
    if (!canReview) { const e=new Error("No autorizado"); e.status=403; throw e; }
    const obs = (req.body?.observacion || '').toString();
    // Pre-cargar voucher para conocer el tipo
    const current = await vouchersService.getVoucherById(id);
    const updated = await vouchersService.setStatus(id, 'rejected', obs);
    // Notificar al dueño del voucher
    try {
      if (updated?.id_user) {
        await notifications.create({
          id_user: Number(updated.id_user),
          type: 'tesoreria_rechazo',
          title: 'Tesorería: Comprobante rechazado',
          message: obs || 'Tu comprobante fue rechazado',
          entity_type: 'voucher',
          entity_id: Number(id),
        });
      }
      // Si es pago de certificado, notificar también a Inglés y Vinculación
      if (current?.voucher_type === 'pago_certificado') {
        await notifications.notifyRoles({
          roles: ['Ingles','Vinculacion_Practicas'],
          type: 'pago_certificado_rechazado',
          title: 'Pago de certificado rechazado',
          message: `Voucher ${id} rechazado`,
          entity_type: 'voucher',
          entity_id: Number(id),
        });
      }
    } catch (_) { /* no bloquear */ }
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove, download, approve, reject };
