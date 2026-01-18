const documentsService = require("../services/documentsService");
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
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const q = { ...req.query };
    if (!canReview) {
      const me = getUserId(req);
      q.id_user = me;
      q.id_owner = me;
      // Por defecto, en el panel de estudiante solo mostrar documentos de matrícula (no comprobantes de pagos)
      // Aplique este filtro a menos que se pida un tipo explícito.
      if (!q.tipo && !q.doc_type && !q.document_type) {
        q.category = 'matricula';
      }
    }
    const result = await documentsService.listDocuments(q);
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
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    const ownerId = Number.isFinite(doc.usuario_id) ? doc.usuario_id : (Number.isFinite(doc.id_user) ? doc.id_user : undefined);
    if (!canReview && ownerId !== me) {
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const createSchema = z.object({
      tipo: z.enum([
        'comprobante_certificados','comprobante_titulacion','comprobante_acta_grado',
        'solicitud','oficio','uic_final','uic_acta_tribunal',
        'cert_tesoreria','cert_secretaria','cert_vinculacion','cert_ingles','cert_practicas'
      ], { message: 'tipo inválido' }).or(z.string()),
      usuario_id: z.coerce.number().int({ message: 'usuario_id debe ser entero' }).optional(),
      estudiante_id: z.coerce.number().int().optional(),
      pago_referencia: z.string().optional(),
      pago_monto: z.coerce.number().optional(),
    });
    const parsed = createSchema.parse(req.body || {});
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    // Si viene usuario_id y no coincide, bloquear; si no viene, asumimos el actual
    if (!canReview && parsed.usuario_id !== undefined && parsed.usuario_id !== me) {
      const e = new Error("No autorizado: no puede crear para otro usuario");
      e.status = 403;
      throw e;
    }
    const payload = { ...parsed };
    if (!payload.usuario_id) payload.usuario_id = me;
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      const rel = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.ruta_archivo = rel;
      payload.nombre_archivo = req.file.originalname || null;
      payload.mime_type = req.file.mimetype || null;
      if (!payload.usuario_id) payload.usuario_id = getUserId(req);
    }
    const created = await documentsService.createDocument(payload);
    // Notificar a Secretaría la llegada de nuevo documento
    try {
      const notifications = require("../services/notificationsService");
      await notifications.notifyRoles({
        roles: ['Secretaria'],
        type: 'matricula_nuevo_documento',
        title: 'Nuevo documento recibido',
        message: `Documento ${payload.tipo} del usuario ${payload.usuario_id}`,
        entity_type: 'document',
        entity_id: Number(created?.documento_id || 0),
      });
    } catch (_) { /* no bloquear */ }
    // Gatillo: si es informe final UIC, notificar Coordinación y Tutor
    try {
      if (String(payload.tipo).toLowerCase() === 'uic_final') {
        const notifications = require("../services/notificationsService");
        // Notificar a Coordinación
        await notifications.notifyRoles({
          roles: ['Coordinador'],
          type: 'informe_entregado',
          title: 'Informe final entregado',
          message: `El estudiante ${payload.usuario_id} entregó el informe final UIC`,
          entity_type: 'uic_informe',
          entity_id: Number(created?.documento_id || 0),
        });
        // Resolver Tutor desde uic_topics del período activo
        try {
          const prisma = require("../../prisma/client");
          const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
          const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
          const id_ap = per?.id_academic_periods;
          if (Number.isFinite(Number(id_ap))) {
            const topic = await prisma.uic_topics.findUnique({
              where: { id_user_id_academic_periods: { id_user: Number(payload.usuario_id), id_academic_periods: Number(id_ap) } },
              select: { id_tutor: true }
            });
            if (topic && Number.isFinite(Number(topic.id_tutor))) {
              await notifications.create({
                id_user: Number(topic.id_tutor),
                type: 'informe_entregado',
                title: 'Informe final entregado',
                message: `El estudiante ${payload.usuario_id} entregó el informe final UIC`,
                entity_type: 'uic_informe',
                entity_id: Number(created?.documento_id || 0),
              });
            }
            // Resolver Lector desde uic_asignaciones del período activo
            try {
              const asign = await prisma.uic_asignaciones.findUnique({
                where: { periodo_id_estudiante_id: { periodo_id: Number(id_ap), estudiante_id: Number(payload.usuario_id) } },
                select: { lector_usuario_id: true }
              });
              if (asign && Number.isFinite(Number(asign.lector_usuario_id))) {
                await notifications.create({
                  id_user: Number(asign.lector_usuario_id),
                  type: 'informe_entregado',
                  title: 'Informe final entregado',
                  message: `El estudiante ${payload.usuario_id} entregó el informe final UIC`,
                  entity_type: 'uic_informe',
                  entity_id: Number(created?.documento_id || 0),
                });
              }
            } catch (_) { /* no bloquear lector */ }
          }
        } catch (_) { /* no bloquear tutor */ }
      }
    } catch (_) { /* no bloquear */ }
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
      tipo: z.enum([
        'comprobante_certificados','comprobante_titulacion','comprobante_acta_grado',
        'solicitud','oficio','uic_final','uic_acta_tribunal',
        'cert_tesoreria','cert_secretaria','cert_vinculacion','cert_ingles','cert_practicas'
      ]).optional(),
      usuario_id: z.coerce.number().int().optional(),
      estudiante_id: z.coerce.number().int().optional(),
      ruta_archivo: z.string().optional(),
      nombre_archivo: z.string().optional(),
      mime_type: z.string().optional(),
      pago_referencia: z.string().optional(),
      pago_monto: z.coerce.number().optional(),
      estado: z.enum(['en_revision','aprobado','rechazado','pendiente_pago','finalizado']).optional(),
      observacion: z.string().max(500).optional(),
    });
    const parsed = updateSchema.parse(req.body || {});
    const payload = { ...parsed };
    let newRelPath = null;
    if (req.file && req.file.path) {
      const idx = req.file.path.lastIndexOf("uploads");
      newRelPath = idx >= 0 ? req.file.path.slice(idx).replace(/\\/g, "/") : req.file.path;
      payload.ruta_archivo = newRelPath;
      payload.nombre_archivo = req.file.originalname || null;
      payload.mime_type = req.file.mimetype || null;
      if (!payload.usuario_id) payload.usuario_id = getUserId(req);
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
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    const ownerId = Number.isFinite(current.usuario_id) ? current.usuario_id : (Number.isFinite(current.id_user) ? current.id_user : undefined);
    if (!canReview && ownerId !== me) {
      if (newRelPath) removeFileSafe(newRelPath);
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
    }
    if (!canReview && payload.usuario_id !== undefined && payload.usuario_id !== me) {
      if (newRelPath) removeFileSafe(newRelPath);
      const e = new Error("No autorizado: no puede reasignar dueño");
      e.status = 403;
      throw e;
    }
    if (newRelPath) {
      oldRelPath = current.ruta_archivo || null;
    }

    // Si no hay archivo nuevo pero hay cambio de id_user, mover archivo existente a nueva subcarpeta
    let movedTemp = null;
    if (!newRelPath && payload.usuario_id !== undefined && current.ruta_archivo) {
      const newUserId = Number(payload.usuario_id);
      const currOwner = Number.isFinite(current.usuario_id) ? current.usuario_id : (Number.isFinite(current.id_user) ? current.id_user : undefined);
      if (Number.isFinite(newUserId) && newUserId !== currOwner) {
        const filename = path.basename(current.ruta_archivo);
        const targetRel = path.join("uploads", "documents", String(newUserId), filename).replace(/\\/g, "/");
        try {
          moveFileSafe(current.ruta_archivo, targetRel);
          movedTemp = { from: current.ruta_archivo, to: targetRel };
          payload.ruta_archivo = targetRel;
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
    const current = await documentsService.getDocumentById(id);
    if (!current) {
      const error = new Error("Documento no encontrado");
      error.status = 404;
      throw error;
    }
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    const ownerId = Number.isFinite(current.usuario_id) ? current.usuario_id : (Number.isFinite(current.id_user) ? current.id_user : undefined);
    if (!canReview && ownerId !== me) {
      const e = new Error("No autorizado: dueño requerido");
      e.status = 403;
      throw e;
    }
    const removed = await documentsService.deleteDocument(id);
    if (removed && removed.ruta_archivo) {
      removeFileSafe(removed.ruta_archivo);
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

async function download(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { const e=new Error("ID inválido"); e.status=400; throw e; }
    const doc = await documentsService.getDocumentById(id);
    if (!doc || !doc.ruta_archivo) { const e=new Error("Documento no encontrado"); e.status=404; throw e; }
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    const ownerId = Number.isFinite(doc.usuario_id) ? doc.usuario_id : (Number.isFinite(doc.id_user) ? doc.id_user : undefined);
    if (!canReview && ownerId !== me) { const e=new Error("No autorizado: dueño requerido"); e.status=403; throw e; }
    const abs = toAbsoluteUploadPath(doc.ruta_archivo);
    res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
    const fname = doc.nombre_archivo || `documento_${id}`;
    return res.download(abs, fname);
  } catch (err) {
    next(err);
  }
}

async function checklist(req, res, next) {
  try {
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    const me = getUserId(req);
    let id_user = Number(req.query.id_user || req.query.id_owner || me);
    if (!canReview) id_user = me;
    const modality = req.query.modality || undefined;
    if (!Number.isFinite(id_user)) { const e=new Error("id_user requerido"); e.status=400; throw e; }
    const data = await documentsService.getChecklist({ id_user, modality });
    res.json(data);
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const canReview = hasAnyRole(req, ["Secretaria", "Coordinador"]);
    if (!canReview) { const e=new Error("No autorizado"); e.status=403; throw e; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { const e=new Error("ID inválido"); e.status=400; throw e; }
    const estado = String(req.body?.estado || '').trim();
    const observacion = req.body?.observacion ? String(req.body.observacion) : undefined;
    if (!['en_revision','aprobado','rechazado','pendiente_pago','finalizado'].includes(estado)) {
      const e = new Error('estado inválido');
      e.status = 400;
      throw e;
    }
    const updated = await documentsService.setStatus(id, estado, observacion);
    res.json(updated);
  } catch (err) { next(err); }
}

module.exports = { list, getById, create, update, remove, download, checklist, setStatus };
