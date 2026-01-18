const express = require("express");
const router = express.Router();
const authorize = require("../middlewares/authorize");
const { generarCertNotas, listPromedios, getPromediosById, getNotasDetalle, approve, reject, reconsider, actaLista, actaFirmada, listActas, saveNotaTribunal, generateHoja, linkHoja } = require("../controllers/secretariaController");
const prisma = require("../../prisma/client");

// POST /secretaria/certificados/notas
router.post("/certificados/notas", authorize('Secretaria','Administrador'), generarCertNotas);

// GET /secretaria/promedios
router.get("/promedios", authorize('Secretaria','Administrador'), listPromedios);

// GET /secretaria/promedios/:id
router.get("/promedios/:id", authorize('Secretaria','Administrador'), getPromediosById);

// GET /secretaria/notas/:id
router.get("/notas/:id", authorize('Secretaria','Administrador'), getNotasDetalle);

// PUT /secretaria/validaciones/approve
router.put("/validaciones/approve", authorize('Secretaria','Administrador'), approve);

// PUT /secretaria/validaciones/reject
router.put("/validaciones/reject", authorize('Secretaria','Administrador'), reject);

// PUT /secretaria/validaciones/reconsider
router.put("/validaciones/reconsider", authorize('Secretaria','Administrador'), reconsider);

// PUT /secretaria/actas/:id/lista
router.put("/actas/:id/lista", authorize('Secretaria','Administrador'), actaLista);

// PUT /secretaria/actas/:id/firmada
router.put("/actas/:id/firmada", authorize('Secretaria','Administrador'), actaFirmada);

// ============== Acta de Grado ==============
// GET /secretaria/actas (lista estudiantes con tribunal y estado de hoja)
router.get("/actas", authorize('Secretaria','Administrador'), listActas);
// PUT /secretaria/actas/nota { id_user_student, score }
router.put("/actas/nota", authorize('Secretaria','Administrador'), saveNotaTribunal);
// POST /secretaria/actas/hoja { id_user_student } -> PDF stream
router.post("/actas/hoja", authorize('Secretaria','Administrador'), generateHoja);
// PUT /secretaria/actas/link-hoja { id_user_student, documento_id }
router.put("/actas/link-hoja", authorize('Secretaria','Administrador'), linkHoja);

// GET /secretaria/dashboard
router.get("/dashboard", authorize('Secretaria','Administrador'), async (req, res, next) => {
  try {
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;

    // período activo (con override opcional)
    let id_ap = Number.isFinite(Number(overrideAp)) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }

    // hoy (inicio de día)
    const start = new Date(); start.setHours(0,0,0,0);

    // actas pendientes: asignaciones UIC sin acta_doc_id
    const actasPendientes = Number.isFinite(Number(id_ap))
      ? await prisma.uic_asignaciones.count({ where: { periodo_id: Number(id_ap), OR: [{ acta_doc_id: null }, { acta_doc_id: { equals: undefined } }] } })
      : 0;

    // certificados emitidos hoy (secretaría) en el período activo
    const certificadosEmitidosHoy = Number.isFinite(Number(id_ap))
      ? await prisma.procesos_validaciones.count({
          where: {
            periodo_id: Number(id_ap),
            proceso: 'secretaria_promedios',
            certificado_doc_id: { not: null },
            actualizado_en: { gte: start },
          }
        }).catch(() => 0)
      : 0;

    // matrículas procesadas (modalidades elegidas del período)
    const matriculasProcesadas = Number.isFinite(Number(id_ap))
      ? await prisma.modalidades_elegidas.count({ where: { periodo_id: Number(id_ap) } })
      : 0;

    // solicitudes en curso (validaciones pendientes de secretaría_promedios)
    const solicitudesEnCurso = Number.isFinite(Number(id_ap))
      ? await prisma.procesos_validaciones.count({ where: { periodo_id: Number(id_ap), proceso: 'secretaria_promedios', estado: 'pending' } })
      : 0;

    // estudiantes atendidos hoy (validaciones actualizadas hoy para proceso secretaría)
    const estudiantesAtendidos = Number.isFinite(Number(id_ap))
      ? await prisma.procesos_validaciones.count({ where: { periodo_id: Number(id_ap), proceso: 'secretaria_promedios', actualizado_en: { gte: start } } })
      : 0;

    res.json({ actasPendientes, certificadosEmitidosHoy, matriculasProcesadas, estudiantesAtendidos, solicitudesEnCurso });
  } catch (err) { next(err); }
});

// GET /secretaria/recientes
router.get("/recientes", authorize('Secretaria','Administrador'), async (req, res, next) => {
  try {
    const sinceDays = Number.isFinite(Number(req.query?.days)) ? Number(req.query.days) : 7;
    const since = new Date(); since.setDate(since.getDate() - sinceDays);
    const overrideAp = req.query?.academicPeriodId ? Number(req.query.academicPeriodId) : undefined;
    // período activo (con override opcional)
    let id_ap = Number.isFinite(Number(overrideAp)) ? Number(overrideAp) : undefined;
    if (!Number.isFinite(Number(id_ap))) {
      const ap = await prisma.app_settings.findUnique({ where: { setting_key: 'active_period' } });
      const per = ap?.setting_value ? (typeof ap.setting_value === 'string' ? JSON.parse(ap.setting_value) : ap.setting_value) : null;
      id_ap = per?.id_academic_periods;
    }
    if (!Number.isFinite(Number(id_ap))) return res.json([]);

    // 1) documentos de secretaría
    const docs = await prisma.documentos.findMany({
      where: { tipo: 'cert_secretaria', creado_en: { gte: since } },
      select: { creado_en: true, usuario_id: true },
      orderBy: { creado_en: 'desc' },
      take: 10,
    });
    // 2) validaciones de secretaría
    const vals = await prisma.procesos_validaciones.findMany({
      where: { proceso: 'secretaria_promedios', periodo_id: Number(id_ap), actualizado_en: { gte: since } },
      select: { actualizado_en: true, estudiante_id: true, estado: true },
      orderBy: { actualizado_en: 'desc' },
      take: 10,
    });
    // Mapear usuarios
    const userIds = Array.from(new Set([
      ...docs.map(d => Number(d.usuario_id)).filter(n => Number.isFinite(n)),
      ...vals.map(v => Number(v.estudiante_id)).filter(n => Number.isFinite(n))
    ]));
    const users = userIds.length > 0 ? await prisma.usuarios.findMany({ where: { usuario_id: { in: userIds } }, select: { usuario_id: true, nombre: true, apellido: true } }) : [];
    const nameMap = new Map(users.map(u => [u.usuario_id, `${u.nombre} ${u.apellido}`.trim()]));

    const items = [];
    for (const d of docs) {
      items.push({
        estudiante: nameMap.get(Number(d.usuario_id)) || `Usuario ${d.usuario_id}`,
        tramite: 'Emisión de certificado',
        fecha: d.creado_en,
        estado: 'completado',
      });
    }
    for (const v of vals) {
      items.push({
        estudiante: nameMap.get(Number(v.estudiante_id)) || `Usuario ${v.estudiante_id}`,
        tramite: 'Validación de promedios',
        fecha: v.actualizado_en,
        estado: v.estado === 'approved' ? 'completado' : (v.estado === 'rejected' ? 'rechazado' : 'pendiente'),
      });
    }
    items.sort((a,b)=> new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    res.json(items.slice(0,10));
  } catch (err) { next(err); }
});

module.exports = router;
