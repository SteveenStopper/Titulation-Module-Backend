const prisma = require("../../prisma/client");

async function getLatestExternalPeriodId() {
  const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ID_PERIODO AS id FROM ${EXT_SCHEMA}.MATRICULACION_PERIODO ORDER BY ID_PERIODO DESC LIMIT 1`
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const id = row ? Number(row.id) : null;
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizePeriodName(val) {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function getExternalPeriodIdForLocalPeriod(localPeriodId) {
  const id = Number(localPeriodId);
  if (!Number.isFinite(id)) return null;
  await ensureAppSettingsTable();
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
      `external_period_for_${id}`
    );
    const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!setting?.setting_value) return null;
    const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
    const extId = Number(val?.external_period_id);
    return Number.isFinite(extId) ? extId : null;
  } catch (_) {
    return null;
  }
}

async function setExternalPeriodIdForLocalPeriod(localPeriodId, external_period_id) {
  const id = Number(localPeriodId);
  const extId = Number(external_period_id);
  if (!Number.isFinite(id)) { const e = new Error('id_academic_periods inválido'); e.status = 400; throw e; }
  if (!Number.isFinite(extId)) { const e = new Error('external_period_id inválido'); e.status = 400; throw e; }
  await ensureAppSettingsTable();

  const EXT_SCHEMA = safeSchemaName(process.env.INSTITUTO_SCHEMA) || 'tecnologicolosan_sigala2';
  const extRows = await prisma.$queryRawUnsafe(
    `SELECT ID_PERIODO AS id, NOMBRE_PERIODO AS name FROM ${EXT_SCHEMA}.MATRICULACION_PERIODO WHERE ID_PERIODO = ? LIMIT 1`,
    extId
  );
  const ext = Array.isArray(extRows) && extRows[0] ? extRows[0] : null;
  if (!ext) { const e = new Error('Período del instituto no encontrado'); e.status = 404; throw e; }
  const local = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { nombre: true } });
  if (!local) { const e = new Error('Período local no encontrado'); e.status = 404; throw e; }
  if (normalizePeriodName(ext.name) !== normalizePeriodName(local.nombre)) {
    const e = new Error('El período del instituto seleccionado no coincide con el nombre del período local');
    e.status = 409;
    throw e;
  }

  await prisma.$executeRawUnsafe(
    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    `external_period_for_${id}`, JSON.stringify({ external_period_id: extId })
  );
  return { id_academic_periods: id, external_period_id: extId };
}

async function computePeriodUsageCounts() {
  const tables = [
    { key: 'modalidades_elegidas', sql: 'SELECT periodo_id AS id, COUNT(*) AS n FROM modalidades_elegidas GROUP BY periodo_id' },
    { key: 'procesos_validaciones', sql: 'SELECT periodo_id AS id, COUNT(*) AS n FROM procesos_validaciones GROUP BY periodo_id' },
    { key: 'uic_asignaciones', sql: 'SELECT periodo_id AS id, COUNT(*) AS n FROM uic_asignaciones GROUP BY periodo_id' },
    { key: 'uic_topics', sql: 'SELECT id_academic_periods AS id, COUNT(*) AS n FROM uic_topics GROUP BY id_academic_periods' },
    { key: 'complexivo_materias', sql: 'SELECT periodo_id AS id, COUNT(*) AS n FROM complexivo_materias GROUP BY periodo_id' },
    { key: 'cronogramas', sql: 'SELECT periodo_id AS id, COUNT(*) AS n FROM cronogramas WHERE publicado = true GROUP BY periodo_id' },
    { key: 'academic_grades', sql: 'SELECT id_academic_periods AS id, COUNT(*) AS n FROM academic_grades GROUP BY id_academic_periods' },
    { key: 'veedor_assignments', sql: 'SELECT id_academic_periods AS id, COUNT(*) AS n FROM veedor_assignments GROUP BY id_academic_periods' },
  ];

  const result = new Map();
  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(t.sql);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const id = Number(r?.id);
          const n = Number(r?.n || 0);
          if (!Number.isFinite(id) || id <= 0) continue;
          const prev = result.get(id) || 0;
          result.set(id, prev + (Number.isFinite(n) ? n : 0));
        }
      }
    } catch (_) {
      // ignorar tablas faltantes u otros errores
    }
  }
  return result;
}

async function enforcePeriodExpirations() {
  const today = startOfToday();
  // Cerrar períodos activos vencidos
  await prisma.periodos.updateMany({
    where: { estado: 'activo', fecha_fin: { lt: today } },
    data: { estado: 'cerrado' }
  });

  // Si el active_period apunta a uno vencido, limpiarlo
  await ensureAppSettingsTable();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    'active_period'
  );
  const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!setting || !setting.setting_value) return;
  try {
    const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
    const id = Number(val?.id_academic_periods);
    if (!Number.isFinite(id)) return;
    const per = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { fecha_fin: true, estado: true } });
    if (per && per.fecha_fin && per.fecha_fin < today) {
      await prisma.$executeRawUnsafe('DELETE FROM app_settings WHERE setting_key = ?', 'active_period');
      // Asegurar que no quede marcado activo
      await prisma.periodos.updateMany({ where: { periodo_id: id, estado: 'activo' }, data: { estado: 'cerrado' } });
    }
  } catch (_) {
    // ignorar
  }
}

async function ensureAppSettingsTable() {
  // Crea una tabla simple y compatible: clave única y valor TEXT
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS app_settings (\n' +
    '  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,\n' +
    '  setting_value TEXT NOT NULL\n' +
    ')'
  );
}

// Actualizar un período académico (nombre/fechas/estado)
async function updatePeriod({ id_academic_periods, name, date_start, date_end, status }) {
  const id = Number(id_academic_periods);
  if (!Number.isFinite(id)) { const e = new Error('id_academic_periods inválido'); e.status = 400; throw e; }
  const data = {};
  if (typeof name === 'string') {
    // Validar duplicado por nombre excluyendo este id
    const dupRows = await prisma.$queryRawUnsafe(
      'SELECT 1 FROM periodos WHERE LOWER(nombre) = LOWER(?) AND periodo_id <> ? LIMIT 1',
      String(name),
      id,
    );
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      const e = new Error('Ya existe un período con ese nombre');
      e.status = 409; throw e;
    }
    data.nombre = name;
  }
  if (date_start) data.fecha_inicio = new Date(date_start);
  if (date_end) data.fecha_fin = new Date(date_end);
  if (status) data.estado = status;
  if (Object.keys(data).length === 0) return await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { periodo_id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true } });
  const updated = await prisma.periodos.update({ where: { periodo_id: id }, data, select: { periodo_id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true } });
  // Si cambiamos el nombre y este período es el activo en app_settings, sincronizar el nombre en active_period
  if (typeof name === 'string' && name.trim()) {
    await ensureAppSettingsTable();
    const rows = await prisma.$queryRawUnsafe('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', 'active_period');
    const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (setting) {
      try {
        const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
        if (Number(val?.id_academic_periods) === id) {
          const newVal = JSON.stringify({ id_academic_periods: id, name: String(updated.nombre) });
          await prisma.$executeRawUnsafe('UPDATE app_settings SET setting_value = ? WHERE setting_key = ?', [newVal, 'active_period']);
        }
      } catch (_) { /* ignorar parseo */ }
    }
  }
  return {
    id_academic_periods: Number(updated.periodo_id),
    name: String(updated.nombre),
    date_start: updated.fecha_inicio ? updated.fecha_inicio.toISOString().slice(0, 10) : null,
    date_end: updated.fecha_fin ? updated.fecha_fin.toISOString().slice(0, 10) : null,
    status: updated.estado || 'inactivo',
  };
}

// Cerrar un período: poner inactivo y, si era el activo en app_settings, limpiar active_period
async function closePeriod(id_academic_periods) {
  const id = Number(id_academic_periods);
  if (!Number.isFinite(id)) { const e = new Error('id_academic_periods inválido'); e.status = 400; throw e; }
  await prisma.periodos.updateMany({ where: { periodo_id: id }, data: { estado: 'cerrado' } });
  await ensureAppSettingsTable();
  // Leer active_period y eliminar si coincide
  const rows = await prisma.$queryRawUnsafe('SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1', 'active_period');
  const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (setting) {
    try {
      const val = typeof setting.setting_value === 'string' ? JSON.parse(setting.setting_value) : setting.setting_value;
      if (Number(val?.id_academic_periods) === id) {
        await prisma.$executeRawUnsafe('DELETE FROM app_settings WHERE setting_key = ?', 'active_period');
      }
    } catch (_) { /* ignorar parseo */ }
  }
  const row = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { periodo_id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true } });
  return row ? {
    id_academic_periods: Number(row.periodo_id),
    name: String(row.nombre),
    date_start: row.fecha_inicio ? row.fecha_inicio.toISOString().slice(0, 10) : null,
    date_end: row.fecha_fin ? row.fecha_fin.toISOString().slice(0, 10) : null,
    status: row.estado || 'inactivo',
  } : null;
}

// Limpiar período activo global y poner todos inactivos
async function clearActivePeriod() {
  await prisma.periodos.updateMany({ data: { estado: 'inactivo' } });
  await ensureAppSettingsTable();
  await prisma.$executeRawUnsafe('DELETE FROM app_settings WHERE setting_key = ?', 'active_period');
  return { cleared: true };
}

async function getActivePeriod() {
  await enforcePeriodExpirations();
  await ensureAppSettingsTable();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    'active_period'
  );
  const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!setting) return null;
  const rawVal = setting.setting_value;
  const value = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
  return value || null;
}

async function setActivePeriod({ id_academic_periods, name, external_period_id }) {
  const value = { id_academic_periods, name };
  const valueStr = JSON.stringify(value);
  const id = Number(id_academic_periods);
  if (!Number.isFinite(id)) { const e = new Error('id_academic_periods inválido'); e.status = 400; throw e; }
  await enforcePeriodExpirations();
  const perCheck = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { fecha_fin: true, nombre: true } });
  if (perCheck?.fecha_fin && perCheck.fecha_fin < startOfToday()) {
    const e = new Error('No se puede activar un período cuya fecha fin ya pasó');
    e.status = 409;
    throw e;
  }

  // Validar que el período del instituto seleccionado coincida con el nombre del período local.
  if (external_period_id !== undefined && external_period_id !== null && external_period_id !== '') {
    const extId = Number(external_period_id);
    if (!Number.isFinite(extId)) { const e = new Error('external_period_id inválido'); e.status = 400; throw e; }
    const EXT_SCHEMA = safeSchemaName(process.env.INSTITUTO_SCHEMA) || 'tecnologicolosan_sigala2';
    const extRows = await prisma.$queryRawUnsafe(
      `SELECT ID_PERIODO AS id, NOMBRE_PERIODO AS name FROM ${EXT_SCHEMA}.MATRICULACION_PERIODO WHERE ID_PERIODO = ? LIMIT 1`,
      extId
    );
    const ext = Array.isArray(extRows) && extRows[0] ? extRows[0] : null;
    if (!ext) { const e = new Error('Período del instituto no encontrado'); e.status = 404; throw e; }
    const localName = perCheck?.nombre != null ? String(perCheck.nombre) : String(name || '');
    if (normalizePeriodName(ext.name) !== normalizePeriodName(localName)) {
      const e = new Error('El período del instituto seleccionado no coincide con el nombre del período local');
      e.status = 409;
      throw e;
    }
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const r1 = await tx.periodos.updateMany({ where: { estado: 'activo' }, data: { estado: 'cerrado' } });
      const r2 = await tx.periodos.updateMany({ where: { periodo_id: id }, data: { estado: 'activo' } });
      if (!r2 || !r2.count) { const e = new Error('Período no encontrado para activar'); e.status = 404; throw e; }
      return { inactivos: r1.count || 0, activados: r2.count || 0 };
    });
    // Upsert manual vía SQL fuera de la transacción para compatibilidad con versiones sin RAW en TransactionClient
    await ensureAppSettingsTable();
    await prisma.$executeRawUnsafe(
      'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      'active_period', valueStr
    );

    // Guardar (si viene) el período externo seleccionado del instituto para este período local.
    // IMPORTANTE: no sobreescribir automáticamente con el "último" período del instituto.
    if (external_period_id !== undefined && external_period_id !== null && external_period_id !== '') {
      const extId = Number(external_period_id);
      if (!Number.isFinite(extId)) { const e = new Error('external_period_id inválido'); e.status = 400; throw e; }
      await prisma.$executeRawUnsafe(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        `external_period_for_${id}`, JSON.stringify({ external_period_id: extId })
      );
    }

    return { ...value, meta: result };
  } catch (err) {
    if (!err.status) { err.status = 500; err.message = err.message || 'Error activando período'; }
    throw err;
  }
}

// Listar períodos académicos (para FE)
async function listAllPeriods() {
  await enforcePeriodExpirations();
  const usageMap = await computePeriodUsageCounts();
  const rows = await prisma.periodos.findMany({
    select: { periodo_id: true, nombre: true, fecha_inicio: true, fecha_fin: true, estado: true },
    orderBy: { nombre: 'desc' }
  });
  // Mapear al contrato usado por el FE/controlador (mantener compatibilidad)
  const ids = rows.map(r => Number(r.periodo_id)).filter(n => Number.isFinite(n));
  const externalMap = new Map();
  if (ids.length) {
    await ensureAppSettingsTable();
    try {
      const mapRows = await prisma.$queryRawUnsafe(
        'SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE ?',
        'external_period_for_%'
      );
      if (Array.isArray(mapRows)) {
        for (const r of mapRows) {
          const key = String(r?.setting_key || '');
          const m = key.match(/^external_period_for_(\d+)$/);
          if (!m) continue;
          const id = Number(m[1]);
          if (!Number.isFinite(id)) continue;
          try {
            const val = typeof r.setting_value === 'string' ? JSON.parse(r.setting_value) : r.setting_value;
            const extId = Number(val?.external_period_id);
            if (Number.isFinite(extId)) externalMap.set(id, extId);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return rows.map(r => ({
    id_academic_periods: Number(r.periodo_id),
    name: String(r.nombre),
    date_start: r.fecha_inicio ? r.fecha_inicio.toISOString().slice(0, 10) : null,
    date_end: r.fecha_fin ? r.fecha_fin.toISOString().slice(0, 10) : null,
    status: r.estado || 'inactivo',
    used: (usageMap.get(Number(r.periodo_id)) || 0) > 0,
    external_period_id: externalMap.get(Number(r.periodo_id)) || null,
  }));
}

async function deletePeriod(id_academic_periods) {
  const id = Number(id_academic_periods);
  if (!Number.isFinite(id)) { const e = new Error('id_academic_periods inválido'); e.status = 400; throw e; }
  const per = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { estado: true } });
  if (!per) { const e = new Error('Período no encontrado'); e.status = 404; throw e; }

  const usageMap = await computePeriodUsageCounts();
  const used = (usageMap.get(id) || 0) > 0;
  if (used) {
    const e = new Error('No se puede eliminar un período que ya fue utilizado en el sistema');
    e.status = 409;
    throw e;
  }
  if (String(per.estado) === 'activo') {
    const e = new Error('No se puede eliminar un período activo');
    e.status = 409;
    throw e;
  }
  if (!['inactivo', 'cerrado'].includes(String(per.estado))) {
    const e = new Error('No se puede eliminar este período');
    e.status = 409;
    throw e;
  }

  try {
    const removed = await prisma.$transaction(async (tx) => {
      // Limpiar registros "borrador" que no deben bloquear el borrado del período.
      // Principal caso: cronogramas no publicados y sus items.
      try {
        const crons = await tx.cronogramas.findMany({
          where: { periodo_id: id, publicado: false },
          select: { cronograma_id: true }
        });
        const cronIds = (crons || []).map(c => c.cronograma_id).filter(n => Number.isFinite(Number(n)));
        if (cronIds.length) {
          await tx.cronograma_items.deleteMany({ where: { cronograma_id: { in: cronIds } } });
          await tx.cronogramas.deleteMany({ where: { cronograma_id: { in: cronIds } } });
        }
      } catch (_) {
        // ignorar si tablas no existen o no aplican
      }

      await ensureAppSettingsTable();
      await tx.$executeRawUnsafe('DELETE FROM app_settings WHERE setting_key = ?', `external_period_for_${id}`);
      return await tx.periodos.delete({ where: { periodo_id: id }, select: { periodo_id: true } });
    });

    return { deleted: true, id_academic_periods: Number(removed.periodo_id) };
  } catch (err) {
    // Prisma FK violation
    if (err && (err.code === 'P2003' || String(err.message || '').toLowerCase().includes('foreign key'))) {
      const e = new Error('No se puede eliminar: existen registros relacionados a este período');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

// Crear un período académico
async function createPeriod({ name, date_start, date_end, status }) {
  const today = startOfToday();
  const ds = new Date(date_start);
  const de = new Date(date_end);
  if (isNaN(ds.getTime()) || isNaN(de.getTime())) {
    const e = new Error('Fechas inválidas');
    e.status = 400;
    throw e;
  }
  // Regla: no permitir crear períodos con fechas pasadas
  if (ds < today || de < today) {
    const e = new Error('No se puede crear un período con fechas pasadas');
    e.status = 409;
    throw e;
  }

  // Validar duplicado por nombre (insensible a mayúsculas/minúsculas) usando SQL directo por compatibilidad
  const dupRows = await prisma.$queryRawUnsafe(
    'SELECT 1 FROM periodos WHERE LOWER(nombre) = LOWER(?) LIMIT 1',
    String(name)
  );
  if (Array.isArray(dupRows) && dupRows.length > 0) {
    const e = new Error('Ya existe un período con ese nombre');
    e.status = 409; throw e;
  }

  // Validar duplicado por fechas (mismo inicio/fin)
  const dupDateRows = await prisma.$queryRawUnsafe(
    'SELECT 1 FROM periodos WHERE DATE(fecha_inicio) = DATE(?) AND DATE(fecha_fin) = DATE(?) LIMIT 1',
    date_start,
    date_end,
  );
  if (Array.isArray(dupDateRows) && dupDateRows.length > 0) {
    const e = new Error('Ya existe un período con las mismas fechas');
    e.status = 409;
    throw e;
  }

  const created = await prisma.periodos.create({
    data: {
      nombre: name,
      fecha_inicio: ds,
      fecha_fin: de,
      ...(status ? { estado: status } : {}),
    },
    select: { periodo_id: true, nombre: true }
  });
  return { id_academic_periods: Number(created.periodo_id), name: String(created.nombre) };
}

// Feature flags (habilitaciones)
async function getFeatureFlags() {
  const def = { pagos: false, matricula: false, modalidad: false };
  await ensureAppSettingsTable();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    'feature_flags'
  );
  const setting = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!setting) return def;
  const rawVal = setting.setting_value;
  const val = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
  return { ...def, ...(val || {}) };
}

async function setFeatureFlags(flags) {
  const current = await getFeatureFlags();
  const value = { ...current, ...flags };
  await ensureAppSettingsTable();
  await prisma.$executeRawUnsafe(
    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    'feature_flags', JSON.stringify(value)
  );
  return value;
}

function safeSchemaName(schema) {
  const s = String(schema || '').trim();
  return /^[a-zA-Z0-9_]+$/.test(s) ? s : null;
}

async function listInstitutePeriods() {
  const EXT_SCHEMA = safeSchemaName(process.env.INSTITUTO_SCHEMA) || 'tecnologicolosan_sigala2';
  // Detectar columnas de fechas en la tabla externa para poder autocompletar en el FE
  let hasStart = false;
  let hasEnd = false;
  let startCol = null;
  let endCol = null;
  try {
    const cols = await prisma.$queryRawUnsafe(
      'SELECT COLUMN_NAME AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND COLUMN_NAME IN (?,?,?,?)',
      EXT_SCHEMA,
      'MATRICULACION_PERIODO',
      'FECHA_INICIO',
      'FECHA_FIN',
      'DATE_START',
      'DATE_END'
    );
    const set = new Set((Array.isArray(cols) ? cols : []).map(r => String(r?.c || '').toUpperCase()));
    if (set.has('FECHA_INICIO')) { hasStart = true; startCol = 'FECHA_INICIO'; }
    else if (set.has('DATE_START')) { hasStart = true; startCol = 'DATE_START'; }
    if (set.has('FECHA_FIN')) { hasEnd = true; endCol = 'FECHA_FIN'; }
    else if (set.has('DATE_END')) { hasEnd = true; endCol = 'DATE_END'; }
  } catch (_) {}

  const selectDates = `${hasStart ? `, ${startCol} AS date_start` : ', NULL AS date_start'}${hasEnd ? `, ${endCol} AS date_end` : ', NULL AS date_end'}`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ID_PERIODO AS id, NOMBRE_PERIODO AS name, STATUS_PERIODO AS status${selectDates}
     FROM ${EXT_SCHEMA}.MATRICULACION_PERIODO
     ORDER BY ID_PERIODO DESC`
  );
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  getActivePeriod,
  setActivePeriod,
  listAllPeriods,
  createPeriod,
  updatePeriod,
  closePeriod,
  clearActivePeriod,
  getFeatureFlags,
  setFeatureFlags,
  listInstitutePeriods,
  setExternalPeriodIdForLocalPeriod,
  getExternalPeriodIdForLocalPeriod,
  deletePeriod,
};
