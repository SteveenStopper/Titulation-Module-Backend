const prisma = require("../../prisma/client");

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

async function listVouchers(query) {
  const page = toInt(query.page, 1);
  const pageSize = toInt(query.pageSize, 20);
  const skip = (page - 1) * pageSize;
  const v_type = sanitizeVoucherType(query.v_type);
  const id_user = query.id_user !== undefined ? Number(query.id_user) : undefined;

  const where = {
    ...(v_type ? { v_type } : {}),
    ...(Number.isFinite(id_user) ? { id_user } : {}),
  };

  const [total, data] = await Promise.all([
    prisma.vouchers.count({ where }),
    prisma.vouchers.findMany({
      where,
      orderBy: { id_voucher: "desc" },
      skip,
      take: pageSize,
      select: {
        id_voucher: true,
        v_type: true,
        amount: true,
        reference: true,
        description: true,
        vouchers: true,
        id_user: true,
        users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
      },
    }),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function getVoucherById(id) {
  return prisma.vouchers.findUnique({
    where: { id_voucher: id },
    select: {
      id_voucher: true,
      v_type: true,
      amount: true,
      reference: true,
      description: true,
      vouchers: true,
      id_user: true,
      users: { select: { id_user: true, firstname: true, lastname: true, email: true } },
    },
  });
}

async function createVoucher(payload) {
  const { v_type, amount, reference, description, vouchers, id_user } = payload;
  const sanitizedType = sanitizeVoucherType(v_type);
  if (!sanitizedType || typeof id_user !== "number") {
    const err = new Error(
      "Campos requeridos: v_type (enum válido), id_user (number). amount (number) opcional"
    );
    err.status = 400;
    throw err;
  }

  const amountVal = toDecimal(amount);

  return prisma.vouchers.create({
    data: {
      v_type: sanitizedType,
      amount: amountVal,
      reference: reference ?? null,
      description: description ?? null,
      vouchers: vouchers ?? null,
      id_user,
    },
    select: {
      id_voucher: true,
      v_type: true,
      amount: true,
      reference: true,
      description: true,
      vouchers: true,
      id_user: true,
    },
  });
}

async function updateVoucher(id, payload) {
  const data = {};
  if (payload.v_type !== undefined) {
    const s = sanitizeVoucherType(payload.v_type);
    if (!s) {
      const err = new Error(
        "v_type inválido. Permitidos: pago_matricula, pago_titulacion, pago_certificado, pago_acta_grado, otro"
      );
      err.status = 400;
      throw err;
    }
    data.v_type = s;
  }
  if (payload.amount !== undefined) data.amount = toDecimal(payload.amount);
  if (payload.reference !== undefined) data.reference = payload.reference ?? null;
  if (payload.description !== undefined) data.description = payload.description ?? null;
  if (payload.vouchers !== undefined) data.vouchers = payload.vouchers ?? null;
  if (payload.id_user !== undefined) data.id_user = Number(payload.id_user);

  return prisma.vouchers.update({
    where: { id_voucher: id },
    data,
    select: {
      id_voucher: true,
      v_type: true,
      amount: true,
      reference: true,
      description: true,
      vouchers: true,
      id_user: true,
    },
  });
}

async function deleteVoucher(id) {
  return prisma.vouchers.delete({ where: { id_voucher: id }, select: { id_voucher: true, vouchers: true } });
}

module.exports = {
  listVouchers,
  getVoucherById,
  createVoucher,
  updateVoucher,
  deleteVoucher,
};
