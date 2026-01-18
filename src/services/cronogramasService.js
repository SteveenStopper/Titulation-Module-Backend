const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  try {
    const s = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' }, select: { setting_value: true } });
    if (!s || s.setting_value == null) return null;
    let val = s.setting_value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch (_) { return null; }
    }
    const id = Number(val?.id_academic_periods);
    return Number.isFinite(id) ? id : null;
  } catch (_) { return null; }
}

// Extrae solo el responsable desde la columna descripcion (soporta formato "actividad | responsable")
function onlyResponsible(desc) {
  if (!desc) return '';
  const s = String(desc);
  if (s.includes('|')) {
    const parts = s.split('|');
    return parts[parts.length - 1].trim();
  }
  return s.trim();
}

function mapCronogramaToUIC(cron, items, periodName) {
  const sorted = [...items].sort((a, b) => {
    const ai = a.fecha_inicio instanceof Date ? a.fecha_inicio.getTime() : 0;
    const bi = b.fecha_inicio instanceof Date ? b.fecha_inicio.getTime() : 0;
    if (ai !== bi) return ai - bi;
    const af = a.fecha_fin instanceof Date ? a.fecha_fin.getTime() : 0;
    const bf = b.fecha_fin instanceof Date ? b.fecha_fin.getTime() : 0;
    if (af !== bf) return af - bf;
    return a.cronograma_item_id - b.cronograma_item_id;
  });
  return {
    titulo: 'CRONOGRAMA DEL PROCESO DE TITULACIÓN',
    periodo: periodName || '',
    proyecto: 'PROYECTO DE TESIS',
    filas: sorted.map((i, idx) => ({
      nro: idx + 1,
      actividad: i.titulo,
      responsable: onlyResponsible(i.descripcion),
      fechaInicio: i.fecha_inicio ? i.fecha_inicio.toISOString().slice(0, 10) : undefined,
      fechaFin: i.fecha_fin ? i.fecha_fin.toISOString().slice(0, 10) : undefined,
    })),
  };
}

async function getUltimoUIC() {
  const cron = await prisma.cronogramas.findFirst({
    where: { modalidad: 'UIC', publicado: true },
    orderBy: { creado_en: 'desc' },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (!cron) return null;
  const [period, items] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return mapCronogramaToUIC(cron, items, period?.nombre || '');
}

async function getUICByPeriod({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return null;
  const cron = await prisma.cronogramas.findFirst({
    where: { modalidad: 'UIC', publicado: true, periodo_id: id_ap },
    orderBy: { creado_en: 'desc' },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (!cron) return null;
  const [period, items] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return mapCronogramaToUIC(cron, items, period?.nombre || '');
}

async function publicarUIC({ id_owner, academicPeriodId, title, period_label, project_label, items }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) {
    const err = new Error("No hay período activo configurado");
    err.status = 400; throw err;
  }
  const creator = Number.isFinite(Number(id_owner)) ? Number(id_owner) : null;
  // Upsert por modalidad/período: único cronograma por período
  let cron = await prisma.cronogramas.findFirst({
    where: { modalidad: 'UIC', periodo_id: id_ap },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (!cron) {
    cron = await prisma.cronogramas.create({
      data: { modalidad: 'UIC', periodo_id: id_ap, publicado: true, creado_por: creator },
      select: { cronograma_id: true, periodo_id: true }
    });
  } else {
    await prisma.cronogramas.update({ where: { cronograma_id: cron.cronograma_id }, data: { publicado: true, creado_por: creator } });
    await prisma.cronograma_items.deleteMany({ where: { cronograma_id: cron.cronograma_id } });
  }
  if (Array.isArray(items) && items.length) {
    for (const it of items) {
      const row = {
        cronograma_id: cron.cronograma_id,
        titulo: String(it.activity_description || ''),
        fecha_inicio: (() => { const d = it.date_start ? new Date(it.date_start) : new Date(); return isNaN(d.getTime()) ? new Date() : d; })(),
        fecha_fin: (() => { const d = it.date_end ? new Date(it.date_end) : new Date(); return isNaN(d.getTime()) ? new Date() : d; })(),
        descripcion: String(it.responsible || ''),
      };
      await prisma.cronograma_items.create({ data: row });
    }
  }
  const [period, savedItems] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return mapCronogramaToUIC(cron, savedItems, period?.nombre || '');
}

function mapCronogramaToComplexivo(cron, items, periodName) {
  const sorted = [...items].sort((a, b) => {
    const ai = a.fecha_inicio instanceof Date ? a.fecha_inicio.getTime() : 0;
    const bi = b.fecha_inicio instanceof Date ? b.fecha_inicio.getTime() : 0;
    if (ai !== bi) return ai - bi;
    const af = a.fecha_fin instanceof Date ? a.fecha_fin.getTime() : 0;
    const bf = b.fecha_fin instanceof Date ? b.fecha_fin.getTime() : 0;
    if (af !== bf) return af - bf;
    return a.cronograma_item_id - b.cronograma_item_id;
  });
  return {
    titulo: 'CRONOGRAMA DEL PROCESO DE TITULACIÓN',
    periodo: periodName || '',
    proyecto: 'EXAMEN COMPLEXIVO',
    filas: sorted.map((i, idx) => ({
      nro: idx + 1,
      actividad: i.titulo,
      responsable: onlyResponsible(i.descripcion),
      fechaInicio: i.fecha_inicio ? i.fecha_inicio.toISOString().slice(0, 10) : undefined,
      fechaFin: i.fecha_fin ? i.fecha_fin.toISOString().slice(0, 10) : undefined,
    })),
  };
}

async function getComplexivoByPeriod({ academicPeriodId }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) return null;
  const cron = await prisma.cronogramas.findFirst({
    where: { modalidad: 'EXAMEN_COMPLEXIVO', publicado: true, periodo_id: id_ap },
    orderBy: { creado_en: 'desc' },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (!cron) return null;
  const [period, items] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return mapCronogramaToComplexivo(cron, items, period?.nombre || '');
}

async function publicarComplexivo({ id_owner, academicPeriodId, title, period_label, project_label, items }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) {
    const err = new Error("No hay período activo configurado");
    err.status = 400; throw err;
  }
  const creator = Number.isFinite(Number(id_owner)) ? Number(id_owner) : null;
  // Upsert por modalidad/período
  let cron = await prisma.cronogramas.findFirst({
    where: { modalidad: 'EXAMEN_COMPLEXIVO', periodo_id: id_ap },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (!cron) {
    cron = await prisma.cronogramas.create({
      data: { modalidad: 'EXAMEN_COMPLEXIVO', periodo_id: id_ap, publicado: true, creado_por: creator },
      select: { cronograma_id: true, periodo_id: true }
    });
  } else {
    await prisma.cronogramas.update({ where: { cronograma_id: cron.cronograma_id }, data: { publicado: true, creado_por: creator } });
    await prisma.cronograma_items.deleteMany({ where: { cronograma_id: cron.cronograma_id } });
  }
  if (Array.isArray(items) && items.length) {
    for (const it of items) {
      const row = {
        cronograma_id: cron.cronograma_id,
        titulo: String(it.activity_description || ''),
        fecha_inicio: (() => { const d = it.date_start ? new Date(it.date_start) : new Date(); return isNaN(d.getTime()) ? new Date() : d; })(),
        fecha_fin: (() => { const d = it.date_end ? new Date(it.date_end) : new Date(); return isNaN(d.getTime()) ? new Date() : d; })(),
        descripcion: String(it.responsible || ''),
      };
      await prisma.cronograma_items.create({ data: row });
    }
  }
  const [period, savedItems] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return mapCronogramaToComplexivo(cron, savedItems, period?.nombre || '');
}

// Crear borrador desde el último cronograma publicado de la misma modalidad
async function crearBorradorDesdeAnterior({ academicPeriodId, modalidad }) {
  const id_ap = academicPeriodId ?? (await getActivePeriodId());
  if (!id_ap) {
    const err = new Error('No hay período activo configurado');
    err.status = 400; throw err;
  }
  // Si ya existe un cronograma (publicado o borrador) para este período, devolverlo
  let cron = await prisma.cronogramas.findFirst({
    where: { modalidad, periodo_id: id_ap },
    orderBy: { creado_en: 'desc' },
    select: { cronograma_id: true, periodo_id: true, publicado: true }
  });
  if (cron) {
    const items = await prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } });
    const period = await prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } });
    return modalidad === 'UIC' ? mapCronogramaToUIC(cron, items, period?.nombre || '') : mapCronogramaToComplexivo(cron, items, period?.nombre || '');
  }
  // Buscar el último publicado de la modalidad
  const anterior = await prisma.cronogramas.findFirst({
    where: { modalidad, publicado: true },
    orderBy: { creado_en: 'desc' },
    select: { cronograma_id: true }
  });
  // Crear borrador vacío si no hay anterior
  cron = await prisma.cronogramas.create({
    data: { modalidad, periodo_id: id_ap, publicado: false },
    select: { cronograma_id: true, periodo_id: true }
  });
  if (anterior) {
    const itemsPrev = await prisma.cronograma_items.findMany({ where: { cronograma_id: anterior.cronograma_id }, select: { titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } });
    for (const it of itemsPrev) {
      await prisma.cronograma_items.create({ data: { cronograma_id: cron.cronograma_id, titulo: it.titulo, fecha_inicio: it.fecha_inicio, fecha_fin: it.fecha_fin, descripcion: it.descripcion } });
    }
  }
  const [period, items] = await Promise.all([
    prisma.periodos.findUnique({ where: { periodo_id: cron.periodo_id }, select: { nombre: true } }),
    prisma.cronograma_items.findMany({ where: { cronograma_id: cron.cronograma_id }, select: { cronograma_item_id: true, titulo: true, fecha_inicio: true, fecha_fin: true, descripcion: true } })
  ]);
  return modalidad === 'UIC' ? mapCronogramaToUIC(cron, items, period?.nombre || '') : mapCronogramaToComplexivo(cron, items, period?.nombre || '');
}

module.exports = { getUltimoUIC, getUICByPeriod, publicarUIC, getComplexivoByPeriod, publicarComplexivo, crearBorradorDesdeAnterior };
