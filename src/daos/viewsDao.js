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

async function getPeriodoRangoSemestresByStudent({ estudiante_id, external_period_id, hasta_sem }) {
  const _hasta = Number(hasta_sem);
  const _est = Number(estudiante_id);
  const _ext = Number(external_period_id);
  if (!Number.isFinite(_hasta) || !Number.isFinite(_est) || !Number.isFinite(_ext)) return null;
  const sql = `
    SELECT
      p1.NOMBRE_PERIODO AS periodo_s1,
      pN.NOMBRE_PERIODO AS periodo_sN
    FROM (
      SELECT
        u3.ID_USUARIOS AS estudiante_id,
        MIN(CASE WHEN cu3.SECUENCIA_CURSOS = 1 THEN mm3.ID_PERIODO_MATRICULA END) AS periodo_s1_id,
        MIN(CASE WHEN cu3.SECUENCIA_CURSOS = ? THEN mm3.ID_PERIODO_MATRICULA END) AS periodo_sN_id
      FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me3
      JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u3
        ON REPLACE(REPLACE(u3.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me3.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
      JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm3
        ON mm3.ID_ESTUDIANTE_MATRICULA = me3.ID_ESTUDIANTES
       AND mm3.ID_PERIODO_MATRICULA <= ?
      JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc3
        ON fc3.ID_FORMAR_CURSOS = mm3.ID_FORMAR_CURSOS_MATRICULA
      JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu3
        ON cu3.ID_CURSOS = fc3.ID_CURSOS_FORMAR_CURSOS
      WHERE u3.ID_USUARIOS = ?
        AND cu3.SECUENCIA_CURSOS IN (1, ?)
      GROUP BY u3.ID_USUARIOS
    ) t
    LEFT JOIN ${EXT_SCHEMA}.MATRICULACION_PERIODO p1
      ON p1.ID_PERIODO = t.periodo_s1_id
    LEFT JOIN ${EXT_SCHEMA}.MATRICULACION_PERIODO pN
      ON pN.ID_PERIODO = t.periodo_sN_id
    LIMIT 1
  `;
  const rows = await prisma.$queryRawUnsafe(sql, _hasta, _ext, _est, _hasta);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getNotasResumenAprobadosByPeriodo({ external_period_id, offset = 0, limit = 20 }) {
  const sql = `
    SELECT
      u.ID_USUARIOS AS estudiante_id,
      u.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(u.NOMBRES_USUARIOS,' ',u.APELLIDOS_USUARIOS) AS nombre,
      c.NOMBRE_CARRERAS AS carrera,
      c.ID_CARRERAS AS carrera_id,
      semAgg.s1,
      semAgg.s2,
      semAgg.s3,
      semAgg.s4,
      semAgg.s5,
      semAgg.promedio_general
    FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON REPLACE(REPLACE(u.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
    JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
      ON mm.ID_ESTUDIANTE_MATRICULA = me.ID_ESTUDIANTES
     AND mm.ID_PERIODO_MATRICULA = ?
    JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc
      ON fc.ID_FORMAR_CURSOS = mm.ID_FORMAR_CURSOS_MATRICULA
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = fc.ID_CARRERA_FORMAR_CURSOS
    JOIN (
      SELECT
        t.estudiante_id,
        MAX(CASE WHEN t.sem = 1 AND t.all_pass = 1 THEN t.avg_nota END) AS s1,
        MAX(CASE WHEN t.sem = 2 AND t.all_pass = 1 THEN t.avg_nota END) AS s2,
        MAX(CASE WHEN t.sem = 3 AND t.all_pass = 1 THEN t.avg_nota END) AS s3,
        MAX(CASE WHEN t.sem = 4 AND t.all_pass = 1 THEN t.avg_nota END) AS s4,
        MAX(CASE WHEN t.sem = 5 AND t.all_pass = 1 THEN t.avg_nota END) AS s5,
        AVG(CASE WHEN t.all_pass = 1 AND t.sem <= 4 THEN t.avg_nota END) AS promedio_general
      FROM (
        SELECT
          u3.ID_USUARIOS AS estudiante_id,
          cu3.SECUENCIA_CURSOS AS sem,
          AVG(n3.NOTA_FINAL_SUMA_NOTA_FINAL_DIVIDE_2_NOTAS) AS avg_nota,
          MIN(CASE WHEN n3.CONDICION_FINAL_NOTAS = 'APRUEBA' THEN 1 ELSE 0 END) AS all_pass
        FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me3
        JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u3
          ON REPLACE(REPLACE(u3.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me3.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
        JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm3
          ON mm3.ID_ESTUDIANTE_MATRICULA = me3.ID_ESTUDIANTES
         AND mm3.ID_PERIODO_MATRICULA <= ?
        JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc3
          ON fc3.ID_FORMAR_CURSOS = mm3.ID_FORMAR_CURSOS_MATRICULA
        JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu3
          ON cu3.ID_CURSOS = fc3.ID_CURSOS_FORMAR_CURSOS
        JOIN ${EXT_SCHEMA}.NOTAS_NOTAS n3
          ON n3.ID_MATRICULA_NOTAS = mm3.ID_MATRICULA
        WHERE cu3.SECUENCIA_CURSOS BETWEEN 1 AND 4
        GROUP BY u3.ID_USUARIOS, cu3.SECUENCIA_CURSOS
      ) t
      GROUP BY t.estudiante_id
    ) semAgg
      ON semAgg.estudiante_id = u.ID_USUARIOS
    WHERE (u.STATUS_USUARIOS='ACTIVO' OR u.STATUS_USUARIOS IS NULL)
      AND (
        (
          c.NOMBRE_CARRERAS = 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL AND semAgg.s4 IS NOT NULL
        )
        OR
        (
          c.NOMBRE_CARRERAS <> 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL
        )
      )
    GROUP BY u.ID_USUARIOS
    ORDER BY nombre ASC
    LIMIT ?, ?
  `;

  return prisma.$queryRawUnsafe(
    sql,
    Number(external_period_id),
    Number(external_period_id),
    Number(offset),
    Number(limit)
  );
}

async function getNotasResumenAprobadosByPeriodoById({ external_period_id, estudiante_id }) {
  const sql = `
    SELECT
      u.ID_USUARIOS AS estudiante_id,
      u.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(u.NOMBRES_USUARIOS,' ',u.APELLIDOS_USUARIOS) AS nombre,
      c.NOMBRE_CARRERAS AS carrera,
      c.ID_CARRERAS AS carrera_id,
      semAgg.s1,
      semAgg.s2,
      semAgg.s3,
      semAgg.s4,
      semAgg.s5,
      semAgg.promedio_general
    FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON REPLACE(REPLACE(u.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
    JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
      ON mm.ID_ESTUDIANTE_MATRICULA = me.ID_ESTUDIANTES
     AND mm.ID_PERIODO_MATRICULA = ?
    JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc
      ON fc.ID_FORMAR_CURSOS = mm.ID_FORMAR_CURSOS_MATRICULA
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = fc.ID_CARRERA_FORMAR_CURSOS
    JOIN (
      SELECT
        t.estudiante_id,
        MAX(CASE WHEN t.sem = 1 AND t.all_pass = 1 THEN t.avg_nota END) AS s1,
        MAX(CASE WHEN t.sem = 2 AND t.all_pass = 1 THEN t.avg_nota END) AS s2,
        MAX(CASE WHEN t.sem = 3 AND t.all_pass = 1 THEN t.avg_nota END) AS s3,
        MAX(CASE WHEN t.sem = 4 AND t.all_pass = 1 THEN t.avg_nota END) AS s4,
        MAX(CASE WHEN t.sem = 5 AND t.all_pass = 1 THEN t.avg_nota END) AS s5,
        AVG(CASE WHEN t.all_pass = 1 AND t.sem <= 4 THEN t.avg_nota END) AS promedio_general
      FROM (
        SELECT
          u3.ID_USUARIOS AS estudiante_id,
          cu3.SECUENCIA_CURSOS AS sem,
          AVG(n3.NOTA_FINAL_SUMA_NOTA_FINAL_DIVIDE_2_NOTAS) AS avg_nota,
          MIN(CASE WHEN n3.CONDICION_FINAL_NOTAS = 'APRUEBA' THEN 1 ELSE 0 END) AS all_pass
        FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me3
        JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u3
          ON REPLACE(REPLACE(u3.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me3.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
        JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm3
          ON mm3.ID_ESTUDIANTE_MATRICULA = me3.ID_ESTUDIANTES
         AND mm3.ID_PERIODO_MATRICULA <= ?
        JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc3
          ON fc3.ID_FORMAR_CURSOS = mm3.ID_FORMAR_CURSOS_MATRICULA
        JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu3
          ON cu3.ID_CURSOS = fc3.ID_CURSOS_FORMAR_CURSOS
        JOIN ${EXT_SCHEMA}.NOTAS_NOTAS n3
          ON n3.ID_MATRICULA_NOTAS = mm3.ID_MATRICULA
        WHERE cu3.SECUENCIA_CURSOS BETWEEN 1 AND 4
          AND u3.ID_USUARIOS = ?
        GROUP BY u3.ID_USUARIOS, cu3.SECUENCIA_CURSOS
      ) t
      GROUP BY t.estudiante_id
    ) semAgg
      ON semAgg.estudiante_id = u.ID_USUARIOS
    WHERE u.ID_USUARIOS = ?
      AND (
        (
          c.NOMBRE_CARRERAS = 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL AND semAgg.s4 IS NOT NULL
        )
        OR
        (
          c.NOMBRE_CARRERAS <> 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL
        )
      )
    LIMIT 1
  `;

  const rows = await prisma.$queryRawUnsafe(
    sql,
    Number(external_period_id),
    Number(external_period_id),
    Number(estudiante_id),
    Number(estudiante_id)
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getNotasResumenTitulacionByPeriodo({ external_period_id, offset = 0, limit = 20 }) {
  const sql = `
    SELECT
      u.ID_USUARIOS AS estudiante_id,
      u.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(u.NOMBRES_USUARIOS,' ',u.APELLIDOS_USUARIOS) AS nombre,
      c.NOMBRE_CARRERAS AS carrera,
      c.ID_CARRERAS AS carrera_id,
      semActual.semestre_actual,
      semAgg.s1,
      semAgg.s2,
      semAgg.s3,
      semAgg.s4,
      semAgg.s5,
      semAgg.promedio_general
    FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON REPLACE(REPLACE(u.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
    JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
      ON mm.ID_ESTUDIANTE_MATRICULA = me.ID_ESTUDIANTES
     AND mm.ID_PERIODO_MATRICULA = ?
    JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc
      ON fc.ID_FORMAR_CURSOS = mm.ID_FORMAR_CURSOS_MATRICULA
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = fc.ID_CARRERA_FORMAR_CURSOS
    JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu
      ON cu.ID_CURSOS = fc.ID_CURSOS_FORMAR_CURSOS
    JOIN (
      SELECT
        u2.ID_USUARIOS AS estudiante_id,
        MAX(cu2.SECUENCIA_CURSOS) AS semestre_actual
      FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me2
      JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u2
        ON REPLACE(REPLACE(u2.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me2.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
      JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm2
        ON mm2.ID_ESTUDIANTE_MATRICULA = me2.ID_ESTUDIANTES
       AND mm2.ID_PERIODO_MATRICULA = ?
      JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc2
        ON fc2.ID_FORMAR_CURSOS = mm2.ID_FORMAR_CURSOS_MATRICULA
      JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu2
        ON cu2.ID_CURSOS = fc2.ID_CURSOS_FORMAR_CURSOS
      GROUP BY u2.ID_USUARIOS
    ) semActual
      ON semActual.estudiante_id = u.ID_USUARIOS
    JOIN (
      SELECT
        t.estudiante_id,
        MAX(CASE WHEN t.sem = 1 AND t.all_pass = 1 THEN t.avg_nota END) AS s1,
        MAX(CASE WHEN t.sem = 2 AND t.all_pass = 1 THEN t.avg_nota END) AS s2,
        MAX(CASE WHEN t.sem = 3 AND t.all_pass = 1 THEN t.avg_nota END) AS s3,
        MAX(CASE WHEN t.sem = 4 AND t.all_pass = 1 THEN t.avg_nota END) AS s4,
        MAX(CASE WHEN t.sem = 5 AND t.all_pass = 1 THEN t.avg_nota END) AS s5,
        AVG(CASE WHEN t.all_pass = 1 THEN t.avg_nota END) AS promedio_general
      FROM (
        SELECT
          u3.ID_USUARIOS AS estudiante_id,
          cu3.SECUENCIA_CURSOS AS sem,
          AVG(n3.NOTA_FINAL_SUMA_NOTA_FINAL_DIVIDE_2_NOTAS) AS avg_nota,
          MIN(CASE WHEN n3.CONDICION_FINAL_NOTAS = 'APRUEBA' THEN 1 ELSE 0 END) AS all_pass
        FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me3
        JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u3
          ON REPLACE(REPLACE(u3.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me3.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
        JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm3
          ON mm3.ID_ESTUDIANTE_MATRICULA = me3.ID_ESTUDIANTES
         AND mm3.ID_PERIODO_MATRICULA <= ?
        JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc3
          ON fc3.ID_FORMAR_CURSOS = mm3.ID_FORMAR_CURSOS_MATRICULA
        JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu3
          ON cu3.ID_CURSOS = fc3.ID_CURSOS_FORMAR_CURSOS
        JOIN ${EXT_SCHEMA}.NOTAS_NOTAS n3
          ON n3.ID_MATRICULA_NOTAS = mm3.ID_MATRICULA
        GROUP BY u3.ID_USUARIOS, cu3.SECUENCIA_CURSOS
      ) t
      GROUP BY t.estudiante_id
    ) semAgg
      ON semAgg.estudiante_id = u.ID_USUARIOS
    WHERE (u.STATUS_USUARIOS='ACTIVO' OR u.STATUS_USUARIOS IS NULL)
      AND (
        (
          c.NOMBRE_CARRERAS = 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semActual.semestre_actual = 5
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL AND semAgg.s4 IS NOT NULL
        )
        OR
        (
          c.NOMBRE_CARRERAS <> 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semActual.semestre_actual = 4
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL
        )
      )
    GROUP BY u.ID_USUARIOS
    ORDER BY nombre ASC
    LIMIT ?, ?
  `;
  return prisma.$queryRawUnsafe(
    sql,
    Number(external_period_id),
    Number(external_period_id),
    Number(external_period_id),
    Number(offset),
    Number(limit)
  );
}

async function getNotasResumenTitulacionByPeriodoById({ external_period_id, estudiante_id }) {
  const sql = `
    SELECT
      u.ID_USUARIOS AS estudiante_id,
      u.DOCUMENTO_USUARIOS AS cedula,
      CONCAT(u.NOMBRES_USUARIOS,' ',u.APELLIDOS_USUARIOS) AS nombre,
      c.NOMBRE_CARRERAS AS carrera,
      c.ID_CARRERAS AS carrera_id,
      semActual.semestre_actual,
      semAgg.s1,
      semAgg.s2,
      semAgg.s3,
      semAgg.s4,
      semAgg.s5,
      semAgg.promedio_general
    FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me
    JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u
      ON REPLACE(REPLACE(u.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
    JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm
      ON mm.ID_ESTUDIANTE_MATRICULA = me.ID_ESTUDIANTES
     AND mm.ID_PERIODO_MATRICULA = ?
    JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc
      ON fc.ID_FORMAR_CURSOS = mm.ID_FORMAR_CURSOS_MATRICULA
    JOIN ${EXT_SCHEMA}.MATRICULACION_CARRERAS c
      ON c.ID_CARRERAS = fc.ID_CARRERA_FORMAR_CURSOS
    JOIN (
      SELECT
        u2.ID_USUARIOS AS estudiante_id,
        MAX(cu2.SECUENCIA_CURSOS) AS semestre_actual
      FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me2
      JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u2
        ON REPLACE(REPLACE(u2.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me2.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
      JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm2
        ON mm2.ID_ESTUDIANTE_MATRICULA = me2.ID_ESTUDIANTES
       AND mm2.ID_PERIODO_MATRICULA = ?
      JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc2
        ON fc2.ID_FORMAR_CURSOS = mm2.ID_FORMAR_CURSOS_MATRICULA
      JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu2
        ON cu2.ID_CURSOS = fc2.ID_CURSOS_FORMAR_CURSOS
      WHERE u2.ID_USUARIOS = ?
      GROUP BY u2.ID_USUARIOS
    ) semActual
      ON semActual.estudiante_id = u.ID_USUARIOS
    JOIN (
      SELECT
        t.estudiante_id,
        MAX(CASE WHEN t.sem = 1 AND t.all_pass = 1 THEN t.avg_nota END) AS s1,
        MAX(CASE WHEN t.sem = 2 AND t.all_pass = 1 THEN t.avg_nota END) AS s2,
        MAX(CASE WHEN t.sem = 3 AND t.all_pass = 1 THEN t.avg_nota END) AS s3,
        MAX(CASE WHEN t.sem = 4 AND t.all_pass = 1 THEN t.avg_nota END) AS s4,
        MAX(CASE WHEN t.sem = 5 AND t.all_pass = 1 THEN t.avg_nota END) AS s5,
        AVG(CASE WHEN t.all_pass = 1 THEN t.avg_nota END) AS promedio_general
      FROM (
        SELECT
          u3.ID_USUARIOS AS estudiante_id,
          cu3.SECUENCIA_CURSOS AS sem,
          AVG(n3.NOTA_FINAL_SUMA_NOTA_FINAL_DIVIDE_2_NOTAS) AS avg_nota,
          MIN(CASE WHEN n3.CONDICION_FINAL_NOTAS = 'APRUEBA' THEN 1 ELSE 0 END) AS all_pass
        FROM ${EXT_SCHEMA}.MATRICULACION_ESTUDIANTES me3
        JOIN ${EXT_SCHEMA}.SEGURIDAD_USUARIOS u3
          ON REPLACE(REPLACE(u3.DOCUMENTO_USUARIOS,'-',''),' ','') = REPLACE(REPLACE(me3.DOCUMENTO_ESTUDIANTES,'-',''),' ','')
        JOIN ${EXT_SCHEMA}.MATRICULACION_MATRICULA mm3
          ON mm3.ID_ESTUDIANTE_MATRICULA = me3.ID_ESTUDIANTES
         AND mm3.ID_PERIODO_MATRICULA <= ?
        JOIN ${EXT_SCHEMA}.MATRICULACION_FORMAR_CURSOS fc3
          ON fc3.ID_FORMAR_CURSOS = mm3.ID_FORMAR_CURSOS_MATRICULA
        JOIN ${EXT_SCHEMA}.MATRICULACION_CURSOS cu3
          ON cu3.ID_CURSOS = fc3.ID_CURSOS_FORMAR_CURSOS
        JOIN ${EXT_SCHEMA}.NOTAS_NOTAS n3
          ON n3.ID_MATRICULA_NOTAS = mm3.ID_MATRICULA
        WHERE u3.ID_USUARIOS = ?
        GROUP BY u3.ID_USUARIOS, cu3.SECUENCIA_CURSOS
      ) t
      GROUP BY t.estudiante_id
    ) semAgg
      ON semAgg.estudiante_id = u.ID_USUARIOS
    WHERE u.ID_USUARIOS = ?
      AND (
        (
          c.NOMBRE_CARRERAS = 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semActual.semestre_actual = 5
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL AND semAgg.s4 IS NOT NULL
        )
        OR
        (
          c.NOMBRE_CARRERAS <> 'TECNOLOGÍA EN EDUCACIÓN BÁSICA'
          AND semActual.semestre_actual = 4
          AND semAgg.s1 IS NOT NULL AND semAgg.s2 IS NOT NULL AND semAgg.s3 IS NOT NULL
        )
      )
    LIMIT 1
  `;
  const rows = await prisma.$queryRawUnsafe(
    sql,
    Number(external_period_id),
    Number(external_period_id),
    Number(estudiante_id),
    Number(external_period_id),
    Number(estudiante_id),
    Number(estudiante_id)
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = {
  viewExists,
  getTesoreriaResumen,
  getEstadoFinanciero,
  getSecretariaPromedios,
  getSemestresAprobados,
  getNotasEstudiante,
  getNotasResumenAprobadosByPeriodo,
  getNotasResumenAprobadosByPeriodoById,
  getNotasResumenTitulacionByPeriodo,
  getNotasResumenTitulacionByPeriodoById,
  getPeriodoRangoSemestresByStudent,
};
