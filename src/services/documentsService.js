const prisma = require("../../prisma/client");

async function getPeriodDateRange(academicPeriodId) {
  const id = Number(academicPeriodId);
  if (!Number.isFinite(id)) return null;
  try {
    const per = await prisma.periodos.findUnique({
      where: { periodo_id: id },
      select: { fecha_inicio: true, fecha_fin: true }
    });
    if (!per?.fecha_inicio || !per?.fecha_fin) return null;
    const start = new Date(per.fecha_inicio);
    start.setHours(0, 0, 0, 0);
    const end = new Date(per.fecha_fin);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  } catch (_) {
    return null;
  }
}

async function getActiveAcademicPeriodId() {
  try {
    const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
    const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
    const id = Number(per?.id_academic_periods);
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

function toInt(val, def) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

function sanitizeDocType(val) {
  if (!val) return undefined;
  const allowed = [
    "comprobante_certificados",
    "comprobante_titulacion",
    "comprobante_acta_grado",
    "solicitud",
    "oficio",
    "uic_final",
    "uic_acta_tribunal",
    "cert_tesoreria",
    "cert_secretaria",
    "cert_vinculacion",
    "cert_ingles",
    "cert_practicas",
  ];
  return allowed.includes(val) ? val : undefined;
}

async function listDocuments(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;
  const tipo = sanitizeDocType(query.tipo || query.doc_type || query.document_type);
  const usuario_id = query.usuario_id !== undefined ? Number(query.usuario_id) : (query.id_owner !== undefined ? Number(query.id_owner) : (query.id_user !== undefined ? Number(query.id_user) : undefined));
  const estudiante_id = query.estudiante_id !== undefined ? Number(query.estudiante_id) : undefined;
  const category = (query.category || query.scope || '').toString().toLowerCase();
  const overrideAp = query.academicPeriodId !== undefined ? Number(query.academicPeriodId) : (query.academic_period_id !== undefined ? Number(query.academic_period_id) : undefined);

  // Categorías opcionales para filtrar: 'matricula' (excluir comprobantes), 'pagos' (solo comprobantes)
  const tiposComprobantes = [
    'comprobante_certificados',
    'comprobante_titulacion',
    'comprobante_acta_grado',
  ];
  const tiposMatricula = [
    'solicitud', 'oficio', 'uic_final', 'uic_acta_tribunal',
    'cert_vinculacion', 'cert_ingles', 'cert_practicas',
  ];

  const tiposMatriculaSecretaria = [
    'solicitud', 'oficio',
    'cert_vinculacion', 'cert_ingles', 'cert_practicas',
  ];

  const where = {
    ...(tipo ? { tipo } : {}),
    ...(Number.isFinite(usuario_id) ? { usuario_id } : {}),
    ...(Number.isFinite(estudiante_id) ? { estudiante_id } : {}),
  };

  // Aplicar filtro por categoría si no se envió 'tipo' explícito
  if (!tipo) {
    if (category === 'matricula') {
      where.tipo = { in: tiposMatricula };
    } else if (category === 'matricula_secretaria') {
      where.tipo = { in: tiposMatriculaSecretaria };
    } else if (category === 'pagos') {
      where.tipo = { in: tiposComprobantes };
    }
  }

  // Excluir certificados auto-generados (Secretaría/Tesorería) del listado de Matrícula
  if (category === 'matricula') {
    where.tipo = where.tipo
      ? { ...where.tipo, notIn: ['cert_secretaria', 'cert_tesoreria'] }
      : { notIn: ['cert_secretaria', 'cert_tesoreria'] };
  }

  // Secretaría: excluir certificados auto-generados que se guardan con nombre tipo: cert_*_*.pdf
  // (pero mantener los que sube manualmente el estudiante)
  if (category === 'matricula_secretaria') {
    where.NOT = [
      { tipo: 'cert_ingles', nombre_archivo: { startsWith: 'cert_ingles_' } },
      { tipo: 'cert_practicas', nombre_archivo: { startsWith: 'cert_practicas_' } },
      { tipo: 'cert_vinculacion', nombre_archivo: { startsWith: 'cert_vinculacion_' } },
    ];
  }

  // Period-scoping by date range for period-sensitive categories.
  // The documentos table does not have periodo_id, so we use creado_en within the active period range.
  if ((category === 'matricula' || category === 'matricula_secretaria' || category === 'pagos') && !where.creado_en) {
    const apId = Number.isFinite(Number(overrideAp)) ? Number(overrideAp) : await getActiveAcademicPeriodId();
    if (Number.isFinite(Number(apId))) {
      const range = await getPeriodDateRange(apId);
      if (range?.start && range?.end) {
        where.creado_en = { gte: range.start, lte: range.end };
      }
    }
  }

  const [total, data] = await Promise.all([
    prisma.documentos.count({ where }),
    prisma.documentos.findMany({
      where,
      orderBy: { documento_id: "desc" },
      skip,
      take: pageSize,
      select: {
        documento_id: true,
        tipo: true,
        estado: true,
        ruta_archivo: true,
        nombre_archivo: true,
        mime_type: true,
        pago_referencia: true,
        pago_monto: true,
        observacion: true,
        creado_en: true,
        usuario_id: true,
        estudiante_id: true,
        usuarios: { select: { usuario_id: true, nombre: true, apellido: true } },
      },
    }),
  ]);

  return {
    data: (data || []).map(d => ({
      ...d,
      users: d.usuarios ? { id_user: d.usuarios.usuario_id, firstname: d.usuarios.nombre, lastname: d.usuarios.apellido } : null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getDocumentById(id) {
  return prisma.documentos.findUnique({
    where: { documento_id: id },
    select: {
      documento_id: true,
      tipo: true,
      estado: true,
      ruta_archivo: true,
      nombre_archivo: true,
      mime_type: true,
      pago_referencia: true,
      pago_monto: true,
      observacion: true,
      creado_en: true,
      usuario_id: true,
      estudiante_id: true,
    },
  });
}

async function createDocument(payload) {
  const { tipo, ruta_archivo, usuario_id, nombre_archivo, mime_type, pago_referencia, pago_monto, estudiante_id, observacion } = payload;
  if (!tipo || !ruta_archivo || typeof usuario_id !== "number") {
    const err = new Error("Campos requeridos: tipo, ruta_archivo, usuario_id (number)");
    err.status = 400;
    throw err;
  }
  const sanitizedDocType = sanitizeDocType(tipo);
  if (!sanitizedDocType) {
    const err = new Error("tipo de documento inválido");
    err.status = 400;
    throw err;
  }

  return prisma.documentos.create({
    data: {
      tipo: sanitizedDocType,
      ruta_archivo,
      nombre_archivo: nombre_archivo ?? null,
      mime_type: mime_type ?? null,
      pago_referencia: pago_referencia ?? null,
      pago_monto: pago_monto ?? null,
      observacion: observacion ?? null,
      usuario_id,
      ...(Number.isFinite(estudiante_id) ? { estudiante_id } : {}),
    },
    select: {
      documento_id: true,
      tipo: true,
      estado: true,
      ruta_archivo: true,
      nombre_archivo: true,
      mime_type: true,
      pago_referencia: true,
      pago_monto: true,
      observacion: true,
      creado_en: true,
      usuario_id: true,
      estudiante_id: true,
    },
  });
}

async function updateDocument(id, payload) {
  const data = {};
  if (payload.tipo !== undefined || payload.doc_type !== undefined || payload.document_type !== undefined) {
    const sanitizedDocType = sanitizeDocType(payload.tipo || payload.document_type || payload.doc_type);
    if (!sanitizedDocType) {
      const err = new Error("tipo de documento inválido");
      err.status = 400;
      throw err;
    }
    data.tipo = sanitizedDocType;
  }
  if (payload.ruta_archivo !== undefined) data.ruta_archivo = payload.ruta_archivo;
  if (payload.nombre_archivo !== undefined) data.nombre_archivo = payload.nombre_archivo;
  if (payload.mime_type !== undefined) data.mime_type = payload.mime_type;
  if (payload.pago_referencia !== undefined) data.pago_referencia = payload.pago_referencia;
  if (payload.pago_monto !== undefined) data.pago_monto = Number(payload.pago_monto);
  if (payload.usuario_id !== undefined || payload.id_owner !== undefined || payload.id_user !== undefined) data.usuario_id = Number(payload.usuario_id ?? payload.id_owner ?? payload.id_user);
  if (payload.estudiante_id !== undefined) data.estudiante_id = Number(payload.estudiante_id);
  if (payload.estado !== undefined || payload.status !== undefined) {
    const st = String(payload.estado ?? payload.status);
    if (!['en_revision', 'aprobado', 'rechazado'].includes(st)) {
      const err = new Error("estado inválido");
      err.status = 400;
      throw err;
    }
    data.estado = st;
  }
  if (payload.observacion !== undefined || payload.observation !== undefined) {
    const obs = payload.observacion ?? payload.observation;
    data.observacion = (obs == null ? null : String(obs));
  }

  return prisma.documentos.update({
    where: { documento_id: id },
    data,
    select: {
      documento_id: true,
      tipo: true,
      estado: true,
      ruta_archivo: true,
      nombre_archivo: true,
      mime_type: true,
      pago_referencia: true,
      pago_monto: true,
      observacion: true,
      creado_en: true,
      usuario_id: true,
      estudiante_id: true,
    },
  });
}

async function setStatus(id, estado, observacion) {
  const st = String(estado);
  if (!['en_revision', 'aprobado', 'rechazado'].includes(st)) {
    const err = new Error('estado inválido');
    err.status = 400;
    throw err;
  }
  return prisma.documentos.update({
    where: { documento_id: Number(id) },
    data: { estado: st, ...(observacion ? { observacion: String(observacion) } : {}) },
    select: { documento_id: true, estado: true }
  });
}

async function deleteDocument(id) {
  return prisma.documentos.delete({
    where: { documento_id: id },
    select: { documento_id: true, ruta_archivo: true },
  });
}

module.exports = {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  setStatus,
};

// Checklist por usuario/modadlidad (reglas simples; extender según necesidad)
function getRequiredByModality(modality) {
  const base = [
    { key: 'solicitud', nombre: 'Solicitud' },
    { key: 'oficio', nombre: 'Oficio' },
    { key: 'informe_final', nombre: 'Informe final' },
  ];
  // Ejemplo: agregar requeridos por modalidad si aplica
  if (modality === 'EXAMEN_COMPLEXIVO') {
    return base;
  }
  return base;
}

async function getChecklist({ id_user, modality }) {
  const rows = await prisma.documentos.findMany({
    where: { usuario_id: Number(id_user) },
    select: { tipo: true },
  });
  const presentes = new Set(rows.map(r => String(r.tipo || '').toLowerCase()));
  const required = getRequiredByModality(modality);
  const items = required.map(r => ({
    key: r.key,
    nombre: r.nombre,
    estado: presentes.has(r.key) ? 'aprobado' : 'pendiente',
  }));
  return { userId: id_user, modality: modality || null, items };
}

module.exports.getChecklist = getChecklist;
