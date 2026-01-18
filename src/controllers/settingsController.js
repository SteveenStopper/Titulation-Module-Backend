const { z } = require("zod");
const settingsService = require("../services/settingsService");
const notifications = require("../services/notificationsService");
const prisma = require("../../prisma/client");

async function getActivePeriod(req, res, next) {
  try {
    const val = await settingsService.getActivePeriod();
    res.json(val || {});
  } catch (err) { next(err); }
}

async function setActivePeriod(req, res, next) {
  try {
    const schema = z.object({
      id_academic_periods: z.coerce.number().int(),
      name: z.string().min(1),
    });
    const input = schema.parse(req.body || {});
    console.log('[settings] setActivePeriod input:', input);
    // Validar que el período exista antes de activar
    try {
      const prisma = require("../../prisma/client");
      const exists = await prisma.periodos.findUnique({ where: { periodo_id: Number(input.id_academic_periods) }, select: { periodo_id: true } });
      if (!exists) { const e = new Error('Período no encontrado'); e.status = 404; throw e; }
    } catch (e) { if (!e.status) { e.status = 500; e.message = 'Error validando período'; } throw e; }

    const value = await settingsService.setActivePeriod(input);
    console.log('[settings] setActivePeriod done:', value);
    // Notificar a todos los roles sobre nuevo período activo
    try {
      await notifications.notifyRoles({
        roles: [
          'Administrador','Estudiante','Secretaria','Tesoreria','Coordinador','Docente','Vicerrector','Ingles','Vinculacion_Practicas'
        ],
        type: 'periodo_nuevo',
        title: `Nuevo período activo: ${value.name}`,
        message: `Se ha establecido el período activo ${value.name}.`,
        entity_type: 'period',
        entity_id: Number(value.id_academic_periods),
      });
    } catch (e) { /* continuar sin bloquear respuesta */ }
    res.json(value);
  } catch (err) {
    try { console.error('[settings] setActivePeriod error:', err); } catch(_) {}
    if (err.name === "ZodError") {
      err.status = 400; err.message = err.errors.map(e=>e.message).join(", ");
    }
    // Devolver error claro
    res.status(err.status || 500).json({ message: err.message || 'Error activando período' });
  }
}

module.exports = { getActivePeriod, setActivePeriod };
async function listPeriods(req, res, next) {
  try { const rows = await settingsService.listAllPeriods(); res.json(rows || []); }
  catch (err) { next(err); }
}

module.exports = { getActivePeriod, setActivePeriod, listPeriods };

// Feature flags (habilitaciones)
async function getFeatureFlags(req, res, next) {
  try {
    const flags = await settingsService.getFeatureFlags();
    res.json(flags);
  } catch (err) { next(err); }
}

// PUT /settings/periods/:id  body: { name?, date_start?, date_end?, status? }
async function updatePeriod(req, res, next) {
  try {
    const schema = z.object({
      id: z.coerce.number().int(),
      name: z.string().min(1).optional(),
      date_start: z.string().optional(),
      date_end: z.string().optional(),
      status: z.enum(['activo','inactivo']).optional(),
    });
    const parsed = schema.parse({ id: req.params.id, ...req.body });
    const value = await settingsService.updatePeriod({
      id_academic_periods: parsed.id,
      name: parsed.name,
      date_start: parsed.date_start,
      date_end: parsed.date_end,
      status: parsed.status,
    });
    res.json(value);
  } catch (err) {
    if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e=>e.message).join(', ');} next(err);
  }
}

// POST /settings/periods/:id/close
async function closePeriod(req, res, next) {
  try {
    const schema = z.object({ id: z.coerce.number().int() });
    const { id } = schema.parse({ id: req.params.id });
    const value = await settingsService.closePeriod(id);
    res.json(value || {});
  } catch (err) {
    if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e=>e.message).join(', ');} next(err);
  }
}

// DELETE /settings/active-period  (opcional: limpiar y poner todos inactivos)
async function clearActivePeriod(req, res, next) {
  try {
    const value = await settingsService.clearActivePeriod();
    res.json(value);
  } catch (err) { next(err); }
}

// GET /settings/admin-stats
async function getAdminStats(req, res, next) {
  try {
    const rolesProceso = [
      'Administrador','Estudiante','Secretaria','Tesoreria','Coordinador','Docente','Vicerrector','Ingles','Vinculacion_Practicas'
    ];
    // Contar usuarios activos con cualquiera de esos roles en la tabla "usuarios"
    const rows = await prisma.usuarios.count({
      where: {
        AND: [
          { activo: true },
          { usuario_roles: { some: { roles: { nombre: { in: rolesProceso } } } } }
        ]
      }
    });
    const usersTotal = Number(rows) || 0;
    res.json({ usersTotal });
  } catch (err) { next(err); }
}

module.exports.getAdminStats = getAdminStats;

module.exports.updatePeriod = updatePeriod;
module.exports.closePeriod = closePeriod;
module.exports.clearActivePeriod = clearActivePeriod;

async function setFeatureFlags(req, res, next) {
  try {
    const schema = z.object({ pagos: z.coerce.boolean().optional(), matricula: z.coerce.boolean().optional(), modalidad: z.coerce.boolean().optional() });
    const input = schema.parse(req.body || {});
    const value = await settingsService.setFeatureFlags(input);
    // notificar habilitaciones actualizadas a Estudiantes y Coordinadores
    try {
      await notifications.notifyRoles({
        roles: ['Estudiante','Coordinador'],
        type: 'habilitaciones_actualizadas',
        title: 'Habilitaciones actualizadas',
        message: `Pagos: ${value.pagos ? 'ON' : 'OFF'} | Matrícula: ${value.matricula ? 'ON' : 'OFF'} | Modalidad: ${value.modalidad ? 'ON' : 'OFF'}`,
        entity_type: 'feature_flags',
        entity_id: 0,
      });
    } catch (_) { /* no bloquear */ }
    res.json(value);
  } catch (err) { if (err.name==='ZodError'){ err.status=400; err.message=err.errors.map(e=>e.message).join(', ');} next(err); }
}

module.exports.getFeatureFlags = getFeatureFlags;
module.exports.setFeatureFlags = setFeatureFlags;

// Crear período académico
async function createPeriod(req, res, next) {
  try {
    const schema = z.object({
      name: z.string().min(1, 'name requerido'),
      date_start: z.string().min(1, 'date_start requerido'),
      date_end: z.string().min(1, 'date_end requerido'),
      status: z.string().optional(),
    });
    const input = schema.parse(req.body || {});

    function normalizeDate(s) {
      const str = String(s || '').trim();
      // dd/MM/yyyy -> yyyy-MM-dd
      const ddmmyyyy = /^(\d{2})[\/](\d{2})[\/](\d{4})$/;
      const ddmmyyyyDash = /^(\d{2})-(\d{2})-(\d{4})$/;
      const mmddyyyy = /^(\d{2})[\/](\d{2})[\/](\d{4})$/;
      const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/;
      if (ddmmyyyy.test(str)) {
        const [, dd, mm, yyyy] = str.match(ddmmyyyy);
        return `${yyyy}-${mm}-${dd}`;
      }
      if (ddmmyyyyDash.test(str)) {
        const [, dd, mm, yyyy] = str.match(ddmmyyyyDash);
        return `${yyyy}-${mm}-${dd}`;
      }
      // MM/DD/YYYY -> yyyy-MM-dd (heurística: si primer token > 12, entonces era DD/MM ya tomado arriba)
      if (mmddyyyy.test(str)) {
        const [, mm, dd, yyyy] = str.match(mmddyyyy);
        return `${yyyy}-${mm}-${dd}`;
      }
      if (yyyymmdd.test(str)) return str;
      return str; // dejar pasar y validar abajo
    }

    const date_start = normalizeDate(input.date_start);
    const date_end = normalizeDate(input.date_end);
    const ds = new Date(date_start);
    const de = new Date(date_end);
    if (isNaN(ds.getTime()) || isNaN(de.getTime())) {
      const e = new Error('Fechas inválidas. Use formato dd/MM/yyyy o yyyy-MM-dd');
      e.status = 400; throw e;
    }

    const created = await settingsService.createPeriod({
      name: input.name,
      date_start,
      date_end,
      status: input.status,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.name === 'ZodError') { err.status = 400; err.message = err.errors.map(e=>e.message).join(', ');} 
    next(err);
  }
}

module.exports.createPeriod = createPeriod;
