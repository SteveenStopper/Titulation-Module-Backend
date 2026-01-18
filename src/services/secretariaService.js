const fs = require("fs");
const path = require("path");
const prisma = require("../../prisma/client");

async function getActivePeriodId() {
  try {
    const setting = await prisma.app_settings.findUnique({ where: { setting_key: "active_period" } });
    if (setting && setting.setting_value) {
      const val = typeof setting.setting_value === "string" ? JSON.parse(setting.setting_value) : setting.setting_value;
      const id = Number(val?.id_academic_periods);
      if (Number.isFinite(id)) return id;
    }
  } catch (_) {
    // ignore
  }

  const last = await prisma.periodos.findFirst({ orderBy: { periodo_id: 'desc' }, select: { periodo_id: true } });
  return last?.periodo_id ?? null;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function generateNotasCertificate({ studentId, academicPeriodId, issuerId }) {
  const periodo_id = academicPeriodId ?? (await getActivePeriodId());
  if (!periodo_id) {
    const err = new Error("No hay período activo configurado"); err.status = 400; throw err;
  }

  // 1) Crear archivo PDF "dummy" (placeholder)
  const uploadsDir = path.join(process.cwd(), "uploads", "certificates", String(studentId));
  ensureDir(uploadsDir);
  const filename = `certificado_notas_${studentId}_${Date.now()}.pdf`;
  const abs = path.join(uploadsDir, filename);
  fs.writeFileSync(abs, Buffer.from("%PDF-1.4\n% DUMMY CERTIFICATE PDF\n"));
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");

  // 2) Crear documento en nuevo repositorio
  const doc = await prisma.documentos.create({
    data: {
      tipo: 'cert_secretaria',
      nombre_archivo: filename,
      ruta_archivo: rel,
      mime_type: 'application/pdf',
      usuario_id: issuerId,
      estudiante_id: studentId,
    },
    select: { documento_id: true },
  });

  // 3) Snapshot de notas (por ahora demo vacío; luego conectar adapter externo)
  const snapshot = { promedio: null, detalle: [] };

  // 4) Enlazar a procesos_validaciones (proceso secretaria_promedios)
  await prisma.procesos_validaciones.upsert({
    where: { proceso_periodo_id_estudiante_id: { proceso: 'secretaria_promedios', periodo_id, estudiante_id: studentId } },
    update: { estado: 'approved', certificado_doc_id: doc.documento_id },
    create: { proceso: 'secretaria_promedios', periodo_id, estudiante_id: studentId, estado: 'approved', certificado_doc_id: doc.documento_id },
  });

  return { documento_id: doc.documento_id, ruta: rel };
}

module.exports = { generateNotasCertificate };

async function setValidacionPromedios({ periodo_id, estudiante_id, estado, observacion = null }) {
  const proceso = 'secretaria_promedios';
  return prisma.procesos_validaciones.upsert({
    where: { proceso_periodo_id_estudiante_id: { proceso, periodo_id, estudiante_id } },
    update: { estado, observacion },
    create: { proceso, periodo_id, estudiante_id, estado, observacion },
    select: { proceso_validacion_id: true, estado: true }
  });
}

async function aprobar({ periodo_id, estudiante_id }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'approved' });
}

async function rechazar({ periodo_id, estudiante_id, observacion }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'rejected', observacion: observacion ?? null });
}

module.exports.aprobar = aprobar;
module.exports.rechazar = rechazar;

async function reconsiderar({ periodo_id, estudiante_id }) {
  const pid = periodo_id ?? (await getActivePeriodId());
  if (!pid) { const err = new Error('No hay período activo configurado'); err.status = 400; throw err; }
  return setValidacionPromedios({ periodo_id: pid, estudiante_id, estado: 'pending', observacion: null });
}

module.exports.reconsiderar = reconsiderar;
