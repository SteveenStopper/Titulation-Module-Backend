const express = require("express");
const router = express.Router();
const authorize = require("../middlewares/authorize");
const { listResumen, approve, reject, reconsider, generateCertificate, downloadCertificateByDoc, downloadCertificateByStudent, reportComprobantes, reportAranceles } = require("../controllers/tesoreriaController");
const prisma = require("../../prisma/client");

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

async function getPeriodDateRange(academicPeriodId) {
  const id = Number(academicPeriodId);
  if (!Number.isFinite(id)) return null;
  try {
    const per = await prisma.periodos.findUnique({ where: { periodo_id: id }, select: { fecha_inicio: true, fecha_fin: true } });
    if (!per?.fecha_inicio || !per?.fecha_fin) return null;
    const start = new Date(per.fecha_inicio); start.setHours(0, 0, 0, 0);
    const end = new Date(per.fecha_fin); end.setHours(23, 59, 59, 999);
    return { start, end };
  } catch (_) {
    return null;
  }
}

// GET /tesoreria/resumen?page=&pageSize=&minSem=
router.get("/resumen", authorize('Tesoreria', 'Administrador', 'Secretaria'), listResumen);

// GET /tesoreria/reportes/comprobantes?academicPeriodId=&careerId=
router.get('/reportes/comprobantes', authorize('Tesoreria', 'Administrador'), reportComprobantes);

// GET /tesoreria/reportes/aranceles?academicPeriodId=&careerId=
router.get('/reportes/aranceles', authorize('Tesoreria', 'Administrador'), reportAranceles);

// PUT /tesoreria/validaciones/approve
router.put("/validaciones/approve", authorize('Tesoreria', 'Administrador'), approve);

// PUT /tesoreria/validaciones/reject
router.put("/validaciones/reject", authorize('Tesoreria', 'Administrador'), reject);

// PUT /tesoreria/validaciones/reconsider
router.put("/validaciones/reconsider", authorize('Tesoreria', 'Administrador'), reconsider);

// POST /tesoreria/certificados
router.post("/certificados", authorize('Tesoreria', 'Administrador'), generateCertificate);

// GET /tesoreria/certificados/:docId/download
router.get("/certificados/:docId/download", authorize('Tesoreria', 'Administrador', 'Secretaria'), downloadCertificateByDoc);

// GET /tesoreria/certificados/by-student/:estudiante_id
router.get("/certificados/by-student/:estudiante_id", authorize('Tesoreria', 'Administrador', 'Secretaria'), downloadCertificateByStudent);

// GET /tesoreria/dashboard
router.get("/dashboard", authorize('Tesoreria', 'Administrador'), async (req, res, next) => {
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    // pagosHoy: # de comprobantes subidos hoy (cualquier tipo comprobante_*)
    const tipos = ['comprobante_certificados', 'comprobante_titulacion', 'comprobante_acta_grado'];

    // período activo para scoping
    const apId = await getActiveAcademicPeriodId();
    const range = apId ? await getPeriodDateRange(apId) : null;
    const periodWhere = (range?.start && range?.end) ? { gte: range.start, lte: range.end } : undefined;

    const pagosHoy = await prisma.documentos.count({
      where: {
        tipo: { in: tipos },
        estado: 'aprobado',
        ...(periodWhere ? { creado_en: { gte: start, lte: periodWhere.lte } } : { creado_en: { gte: start } })
      }
    });

    // recaudadoPeriodo: suma en el rango del período activo
    const sumRows = await prisma.documentos.groupBy({
      by: ['tipo'],
      where: {
        tipo: { in: tipos },
        estado: 'aprobado',
        ...(periodWhere ? { creado_en: periodWhere } : {})
      },
      _sum: { pago_monto: true }
    });
    const recaudadoPeriodo = (sumRows || []).reduce((acc, r) => acc + Number(r._sum.pago_monto || 0), 0);

    // vouchersPendientes: comprobantes en revisión dentro del período
    const vouchersPendientes = await prisma.documentos.count({
      where: {
        tipo: { in: tipos },
        estado: 'en_revision',
        ...(periodWhere ? { creado_en: periodWhere } : {})
      }
    });

    const deudasVencidas = 0;
    const arancelesActivos = 0;
    res.json({ recaudadoPeriodo, vouchersPendientes, pagosHoy, deudasVencidas, arancelesActivos });
  } catch (err) { next(err); }
});

module.exports = router;
