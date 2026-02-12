const { z } = require("zod");
const svc = require("../services/notificationsService");
const prisma = require("../../prisma/client");

async function listMy(req, res, next) {
  try {
    const schema = z.object({ onlyUnread: z.coerce.boolean().optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(200).optional() });
    const { onlyUnread, page, pageSize } = schema.parse(req.query || {});
    const id_user = req.user?.sub;
    if (!id_user) {
      return res.status(200).json([]);
    }
    const roleNames = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const data = await svc.listMy({ id_user, roles: roleNames, onlyUnread, page, pageSize });
    res.json(data);
  } catch(e){
    try {
      return res.status(200).json([]);
    } catch(_) {
      next(e);
    }
  } 
}

async function markRead(req, res, next) {
  try {
    const schema = z.object({ id: z.coerce.bigint() });
    const { id } = schema.parse({ id: req.params.id });
    const id_user = req.user?.sub; if (!id_user){ const e=new Error('No autorizado'); e.status=401; throw e; }
    const data = await svc.markRead({ id_notification: id, id_user });
    res.json(data);
  } catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

async function markAllRead(req, res, next) {
  try {
    const id_user = req.user?.sub; if (!id_user){ const e=new Error('No autorizado'); e.status=401; throw e; }
    const data = await svc.markAllRead({ id_user });
    res.json({ updated: data?.count ?? 0 });
  } catch(e){ next(e); }
}

async function create(req, res, next) {
  try {
    const schema = z.object({ id_user: z.coerce.number().int(), type: z.string().min(1), title: z.string().min(1), message: z.string().optional(), entity_type: z.string().optional(), entity_id: z.coerce.number().int().optional() });
    const body = schema.parse(req.body || {});
    const data = await svc.create(body);
    res.status(201).json(data);
  } catch(e){ if(e.name==='ZodError'){e.status=400;e.message=e.errors.map(x=>x.message).join(', ');} next(e);} 
}

// GET /notifications/admin/recent?limit=10
// Lista notificaciones recientes globales (sin filtrar por usuario), para panel de administrador
async function listRecentAdmin(req, res, next) {
  try {
    const schema = z.object({ limit: z.coerce.number().int().positive().max(100).optional() });
    const { limit } = schema.parse(req.query || {});
    const take = Number.isFinite(limit) ? Number(limit) : 10;
    const rows = await prisma.notificaciones.findMany({
      orderBy: { creado_en: 'desc' },
      take
    });
    const itemsRaw = rows.map((row) => ({
      id_notification: row.notificacion_id,
      type: row.destinatario_rol || 'info',
      title: row.titulo,
      message: row.cuerpo,
      entity_type: null,
      entity_id: null,
      is_read: row.leida,
      created_at: row.creado_en,
    }));

    // Puede existir 1 notificación por rol (mismo título/cuerpo). En el panel admin
    // se muestra actividad global sin agrupar por rol, así que deduplicamos.
    const seen = new Set();
    const items = [];
    for (const it of itemsRaw) {
      const key = `${String(it.title || '').trim()}|${String(it.message || '').trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
      if (items.length >= take) break;
    }

    res.json(items);
  } catch (e) { next(e); }
}

module.exports = { listMy, markRead, markAllRead, create, listRecentAdmin };
