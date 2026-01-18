const prisma = require("../../prisma/client");

// Normaliza el registro de BD (notificaciones) al shape esperado por el FE
function normalize(row) {
  if (!row) return null;
  return {
    id_notification: row.notificacion_id,
    type: row.destinatario_rol || 'info',
    title: row.titulo,
    message: row.cuerpo,
    entity_type: null,
    entity_id: null,
    is_read: row.leida,
    created_at: row.creado_en,
  };
}

async function listMy({ id_user, roles, onlyUnread, page, pageSize }) {
  const take = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : undefined;
  const skip = Number.isFinite(page) && page > 1 && take ? (Math.trunc(page) - 1) * take : undefined;
  const roleFilter = Array.isArray(roles) && roles.length ? { destinatario_rol: { in: roles } } : undefined;
  const rows = await prisma.notificaciones.findMany({
    where: {
      ...(onlyUnread ? { leida: false } : {}),
      OR: [
        { destinatario_usuario_id: id_user },
        ...(roleFilter ? [roleFilter] : [])
      ]
    },
    orderBy: { creado_en: "desc" },
    ...(take ? { take } : {}),
    ...(skip ? { skip } : {}),
  });
  return rows.map(normalize);
}

async function markRead({ id_notification, id_user }) {
  const updated = await prisma.notificaciones.update({
    where: { notificacion_id: Number(id_notification) },
    data: { leida: true },
  });
  return { id_notification: updated.notificacion_id, is_read: updated.leida };
}

async function markAllRead({ id_user }) {
  return prisma.notificaciones.updateMany({
    where: { destinatario_usuario_id: id_user, leida: false },
    data: { leida: true },
  });
}

async function create({ id_user, type, title, message, entity_type, entity_id }) {
  const created = await prisma.notificaciones.create({
    data: { destinatario_usuario_id: id_user, destinatario_rol: type ?? null, titulo: title, cuerpo: message ?? '' },
  });
  return { id_notification: created.notificacion_id, created_at: created.creado_en };
}

// Crear notificaciones para una lista de usuarios
async function createManyUsers({ userIds, type, title, message, entity_type = null, entity_id = null }) {
  const ids = Array.isArray(userIds) ? userIds.map(Number).filter(n => Number.isFinite(n)) : [];
  if (!ids.length) return { count: 0 };
  const data = ids.map(id => ({ destinatario_usuario_id: id, destinatario_rol: type ?? null, titulo: title, cuerpo: message ?? '' }));
  const res = await prisma.notificaciones.createMany({ data, skipDuplicates: true });
  return res;
}

// Crear notificaciones para todos los usuarios que tengan alguno de los roles especificados
async function notifyRoles({ roles, type, title, message, entity_type = null, entity_id = null }) {
  if (!Array.isArray(roles) || roles.length === 0) return { count: 0 };
  const users = await prisma.usuario_roles.findMany({
    where: { roles: { nombre: { in: roles } } },
    select: { usuario_id: true },
    distinct: ["usuario_id"],
  });
  if (!users || users.length === 0) return { count: 0 };
  const data = users.map(u => ({ destinatario_usuario_id: Number(u.usuario_id), destinatario_rol: type ?? null, titulo: title, cuerpo: message ?? '' }));
  const res = await prisma.notificaciones.createMany({ data, skipDuplicates: true });
  return res;
}

module.exports = { listMy, markRead, markAllRead, create, notifyRoles };
module.exports.createManyUsers = createManyUsers;
