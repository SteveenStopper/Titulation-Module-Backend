const prisma = require("../../prisma/client");

const USE_VIEWS = process.env.USE_VIEWS !== "false"; // por defecto usa vistas si existen
const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || "tecnologicolosan_sigala2";

async function viewExists(name) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      name
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    return false;
  }
}

async function selectOrFallback({ viewName, sqlView, sqlFallback, params = [] }) {
  const canUse = USE_VIEWS && (await viewExists(viewName));
  const sql = canUse ? sqlView : sqlFallback;
  return prisma.$queryRawUnsafe(sql, ...params);
}

async function getTesoreriaResumen({ offset = 0, limit = 20, minSem = null }) {
  const whereView = minSem ? "WHERE semestre_aprobado_max >= ?" : "";
  const sqlView = `SELECT * FROM vw_tesoreria_resumen ${whereView} ORDER BY nombre ASC LIMIT ?, ?`;
  const sqlFallback = `
    SELECT
      e.ID_USUARIOS AS estudiante_id,
      e.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(e.NOMBRES_USUARIOS, ' ', e.APELLIDOS_USUARIOS) AS nombre,
      e.ID_CARRERA AS carrera_id,
      c.NOMBRE_CARRERAS AS carrera_nombre,
      0 AS semestre_aprobado_max,
      'Inactivo' AS estado_aranceles
    FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS e
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c ON c.ID_CARRERAS = e.ID_CARRERA
    WHERE e.STATUS_USUARIOS='ACTIVO'
    ORDER BY nombre ASC
    LIMIT ?, ?`;
  const params = [];
  if (minSem) params.push(minSem);
  params.push(offset, limit);
  return selectOrFallback({ viewName: "vw_tesoreria_resumen", sqlView, sqlFallback, params });
}

async function getEstadoFinanciero(estudianteId) {
  const sqlView = `SELECT * FROM vw_estado_financiero WHERE estudiante_id = ?`;
  const sqlFallback = `
    SELECT ? AS estudiante_id,
           'Inactivo' AS estado_aranceles`;
  return selectOrFallback({ viewName: "vw_estado_financiero", sqlView, sqlFallback, params: [estudianteId] });
}

async function getSecretariaPromedios({ offset = 0, limit = 20 }) {
  const sqlView = `SELECT * FROM vw_secretaria_promedios ORDER BY nombre ASC LIMIT ?, ?`;
  const sqlFallback = `
    SELECT 
      u.ID_USUARIOS AS estudiante_id,
      CONCAT(u.NOMBRES_USUARIOS,' ',u.APELLIDOS_USUARIOS) AS nombre,
      c.NOMBRE_CARRERAS AS carrera,
      NULL AS s1, NULL AS s2, NULL AS s3, NULL AS s4,
      NULL AS promedio_general
    FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c ON c.ID_CARRERAS = u.ID_CARRERA
    WHERE u.STATUS_USUARIOS='ACTIVO'
    ORDER BY nombre ASC
    LIMIT ?, ?`;
  return selectOrFallback({ viewName: "vw_secretaria_promedios", sqlView, sqlFallback, params: [offset, limit] });
}

async function getSemestresAprobados(estudianteId) {
  const sqlView = `SELECT semestre_aprobado_max FROM vw_semestres_aprobados WHERE estudiante_id = ?`;
  const sqlFallback = `SELECT 0 AS semestre_aprobado_max`;
  const rows = await selectOrFallback({ viewName: "vw_semestres_aprobados", sqlView, sqlFallback, params: [estudianteId] });
  return Array.isArray(rows) && rows[0] ? Number(rows[0].semestre_aprobado_max || 0) : 0;
}

async function getNotasEstudiante(estudianteId) {
  const sqlView = `
    SELECT * FROM vw_notas_estudiantes WHERE estudiante_id = ?
  `;
  const sqlFallback = `
    SELECT ? AS estudiante_id, NULL AS nombre, NULL AS carrera,
           NULL AS s1, NULL AS s2, NULL AS s3, NULL AS s4,
           NULL AS promedio_general, 'PENDIENTE' AS estado
  `;
  const rows = await selectOrFallback({ viewName: 'vw_notas_estudiantes', sqlView, sqlFallback, params: [estudianteId] });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = {
  viewExists,
  getTesoreriaResumen,
  getEstadoFinanciero,
  getSecretariaPromedios,
  getSemestresAprobados,
  getNotasEstudiante,
};
