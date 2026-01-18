const prisma = require("../../prisma/client");
const path = require("path");

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
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function toDecimal(val) {
  if (val === undefined || val === null) return undefined;
  const num = Number(val);
  if (!Number.isFinite(num)) return undefined;
  return num; // Prisma Decimal se acepta como number/string
}

function sanitizeVoucherType(val) {
  if (!val) return undefined;
  const allowed = [
    "pago_matricula",
    "pago_titulacion",
    "pago_certificado",
    "pago_acta_grado",
    "otro",
  ];
  return allowed.includes(val) ? val : undefined;
}

function sanitizeEstado(val) {
  if (!val) return undefined;
  const v = String(val).toLowerCase();
  if (v === 'approved' || v === 'aprobado') return 'aprobado';
  if (v === 'rejected' || v === 'rechazado') return 'rechazado';
  if (v === 'en_revision' || v === 'en revisión' || v === 'en revision' || v === 'pending') return 'en_revision';
  return undefined;
}

// Mapear tipos API <-> enum documentos.tipo
function voucherTypeToDocumentoTipo(v) {
  switch (v) {
    case 'pago_certificado': return 'comprobante_certificados';
    case 'pago_titulacion': return 'comprobante_titulacion';
    case 'pago_acta_grado': return 'comprobante_acta_grado';
    default: return 'comprobante_titulacion';
  }
}

function documentoTipoToVoucherType(t) {
  switch (t) {
    case 'comprobante_certificados': return 'pago_certificado';
    case 'comprobante_titulacion': return 'pago_titulacion';
    case 'comprobante_acta_grado': return 'pago_acta_grado';
    default: return 'pago_titulacion';
  }
}

async function listVouchers(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;
  const voucher_type = sanitizeVoucherType(query.v_type || query.voucher_type);
  const docTipo = voucher_type ? voucherTypeToDocumentoTipo(voucher_type) : undefined;
  const id_user = query.id_user !== undefined ? Number(query.id_user) : undefined;
  const status = sanitizeEstado(query.status);
  const overrideAp = query.academicPeriodId !== undefined ? Number(query.academicPeriodId) : (query.academic_period_id !== undefined ? Number(query.academic_period_id) : undefined);

  const tiposComprobantes = [
    'comprobante_certificados',
    'comprobante_titulacion',
    'comprobante_acta_grado',
  ];
  const where = {
    ...(docTipo ? { tipo: docTipo } : { tipo: { in: tiposComprobantes } }),
    ...(Number.isFinite(id_user) ? { usuario_id: id_user } : {}),
    ...(status ? { estado: status } : {}),
    AND: [
      {
        OR: [
          { NOT: { pago_monto: null } },
          { NOT: { pago_referencia: null } },
          { ruta_archivo: { startsWith: 'uploads/vouchers' } },
        ],
      },
    ],
  };

  // Period-scoping by date range (same reason as documentsService: documentos table has no periodo_id)
  if (!where.creado_en) {
    const apId = Number.isFinite(Number(overrideAp)) ? Number(overrideAp) : await getActiveAcademicPeriodId();
    if (Number.isFinite(Number(apId))) {
      const range = await getPeriodDateRange(apId);
      if (range?.start && range?.end) {
        where.creado_en = { gte: range.start, lte: range.end };
      }
    }
  }

  try {
    const [total, docs] = await Promise.all([
      prisma.documentos.count({ where }),
      prisma.documentos.findMany({
        where,
        orderBy: { documento_id: 'desc' },
        skip,
        take: pageSize,
        select: {
          documento_id: true,
          tipo: true,
          pago_monto: true,
          pago_referencia: true,
          estado: true,
          observacion: true,
          usuario_id: true,
          ruta_archivo: true,
          nombre_archivo: true,
          mime_type: true,
          creado_en: true,
          usuarios: { select: { usuario_id: true, nombre: true, apellido: true, correo: true } },
        },
      }),
    ]);

    const data = docs.map(d => ({
      id_voucher: d.documento_id,
      voucher_type: documentoTipoToVoucherType(d.tipo),
      amount: d.pago_monto,
      reference: d.pago_referencia,
      status: d.estado,
      observation: d.observacion,
      id_user: d.usuario_id,
      vouchers: d.ruta_archivo,
      filename: d.nombre_archivo,
      mime: d.mime_type,
      created_at: d.creado_en,
      users: d.usuarios ? { id_user: d.usuarios.usuario_id, firstname: d.usuarios.nombre, lastname: d.usuarios.apellido, email: d.usuarios.correo } : null,
    }));

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  } catch (_) {
    return { data: [], pagination: { page, pageSize, total: 0, totalPages: 1 } };
  }
}

async function getVoucherById(id) {
  const d = await prisma.documentos.findUnique({
    where: { documento_id: Number(id) },
    select: {
      documento_id: true,
      tipo: true,
      pago_monto: true,
      pago_referencia: true,
      estado: true,
      observacion: true,
      usuario_id: true,
      ruta_archivo: true,
      nombre_archivo: true,
      mime_type: true,
      creado_en: true,
      usuarios: { select: { usuario_id: true, nombre: true, apellido: true, correo: true } },
    },
  });
  if (!d) return null;
  return {
    id_voucher: d.documento_id,
    voucher_type: documentoTipoToVoucherType(d.tipo),
    amount: d.pago_monto,
    reference: d.pago_referencia,
    status: d.estado,
    observation: d.observacion,
    id_user: d.usuario_id,
    vouchers: d.ruta_archivo,
    filename: d.nombre_archivo,
    mime: d.mime_type,
    created_at: d.creado_en,
    users: d.usuarios ? { id_user: d.usuarios.usuario_id, firstname: d.usuarios.nombre, lastname: d.usuarios.apellido, email: d.usuarios.correo } : null,
  };
}

async function createVoucher(payload) {
  // Guard: validar modelo documentos
  if (!prisma || !prisma.documentos || typeof prisma.documentos.create !== 'function') {
    const err = new Error("Modelo 'documentos' no disponible en Prisma. Aplica migraciones/seed para habilitar pagos.");
    err.status = 500;
    throw err;
  }
  const { v_type, voucher_type, amount, reference, description, id_user } = payload;
  const sanitizedType = sanitizeVoucherType(voucher_type || v_type);
  if (!sanitizedType || typeof id_user !== "number") {
    const err = new Error(
      "Campos requeridos: voucher_type (enum válido), id_user (number). amount (number) opcional"
    );
    err.status = 400;
    throw err;
  }

  const amountVal = toDecimal(amount);
  const docTipo = voucherTypeToDocumentoTipo(sanitizedType);
  try {
    const created = await prisma.documentos.create({
      data: {
        tipo: docTipo,
        usuario_id: Number(id_user),
        pago_monto: amountVal ?? null,
        pago_referencia: reference ?? null,
        ruta_archivo: payload.vouchers ?? null,
        nombre_archivo: payload.filename || (payload.vouchers ? path.basename(payload.vouchers) : 'comprobante'),
        mime_type: payload.mime || null,
      },
      select: { documento_id: true, tipo: true, pago_monto: true, pago_referencia: true, usuario_id: true, ruta_archivo: true, nombre_archivo: true, mime_type: true, creado_en: true },
    });
    return {
      id_voucher: created.documento_id,
      voucher_type: documentoTipoToVoucherType(created.tipo),
      amount: created.pago_monto,
      reference: created.pago_referencia,
      id_user: created.usuario_id,
      vouchers: created.ruta_archivo,
      filename: created.nombre_archivo,
      mime: created.mime_type,
      created_at: created.creado_en,
    };
  } catch (e) {
    if (e && e.code === 'P2003') { // FK failed
      const err = new Error('id_user no existe en la base de datos');
      err.status = 400; throw err;
    }
    throw e;
  }
}

async function updateVoucher(id, payload) {
  const data = {};
  if (payload.v_type !== undefined || payload.voucher_type !== undefined) {
    const s = sanitizeVoucherType(payload.voucher_type || payload.v_type);
    if (!s) {
      const err = new Error(
        "voucher_type inválido. Permitidos: pago_matricula, pago_titulacion, pago_certificado, pago_acta_grado, otro"
      );
      err.status = 400;
      throw err;
    }
    data.tipo = voucherTypeToDocumentoTipo(s);
  }
  if (payload.amount !== undefined) data.pago_monto = toDecimal(payload.amount);
  if (payload.reference !== undefined) data.pago_referencia = payload.reference ?? null;
  if (payload.id_user !== undefined) data.usuario_id = Number(payload.id_user);
  if (payload.vouchers !== undefined) {
    data.ruta_archivo = payload.vouchers ?? null;
    data.nombre_archivo = payload.filename || (payload.vouchers ? path.basename(payload.vouchers) : null);
    if (payload.mime !== undefined) data.mime_type = payload.mime || null;
  }
  const updated = await prisma.documentos.update({
    where: { documento_id: Number(id) },
    data,
    select: { documento_id: true, tipo: true, pago_monto: true, pago_referencia: true, usuario_id: true, ruta_archivo: true, nombre_archivo: true, mime_type: true, creado_en: true },
  });
  return {
    id_voucher: updated.documento_id,
    voucher_type: documentoTipoToVoucherType(updated.tipo),
    amount: updated.pago_monto,
    reference: updated.pago_referencia,
    id_user: updated.usuario_id,
    vouchers: updated.ruta_archivo,
    filename: updated.nombre_archivo,
    mime: updated.mime_type,
    created_at: updated.creado_en,
  };
}

async function deleteVoucher(id) {
  const removed = await prisma.documentos.delete({ where: { documento_id: Number(id) }, select: { documento_id: true, tipo: true, usuario_id: true, ruta_archivo: true } });
  return { id_voucher: removed.documento_id, voucher_type: documentoTipoToVoucherType(removed.tipo), id_user: removed.usuario_id, vouchers: removed.ruta_archivo };
}

module.exports = {
  listVouchers,
  getVoucherById,
  createVoucher,
  updateVoucher,
  deleteVoucher,
  setStatus,
};

async function setStatus(id, status, observation) {
  // Mapear estados del dominio de Tesorería a documentos.estado
  const map = {
    approved: 'aprobado',
    rejected: 'rechazado',
    en_revision: 'en_revision',
    en_review: 'en_revision',
  };
  const targetEstado = map[status] || null;
  if (!targetEstado) {
    const err = new Error("Estado de voucher inválido");
    err.status = 400;
    throw err;
  }
  // Persistir en documentos
  await prisma.documentos.update({
    where: { documento_id: Number(id) },
    data: {
      estado: targetEstado,
      ...(observation !== undefined ? { observacion: observation || null } : {}),
    },
    select: { documento_id: true },
  });
  // Devolver estructura consistente
  const d = await getVoucherById(id);
  return { ...d, status: targetEstado };
}

module.exports.setStatus = setStatus;
