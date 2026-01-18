const prisma = require("../../prisma/client");
const { comparePassword } = require("../utils/password");
const { sign } = require("../utils/jwt");

async function ensureLocalUserForInstituteUser({ institutoId, correo, nombres, apellidos, roleName }) {
  if (!Number.isFinite(Number(institutoId))) return null;

  // 1) Asegurar usuario local con el mismo ID del instituto
  let local = await prisma.usuarios.findUnique({
    where: { usuario_id: Number(institutoId) },
    select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
  });

  if (!local) {
    const baseNombre = String(nombres || '').trim() || `Usuario${Number(institutoId)}`;
    try {
      local = await prisma.usuarios.create({
        data: {
          usuario_id: Number(institutoId),
          nombre: baseNombre,
          apellido: String(apellidos || '').trim(),
          correo: correo || null,
          activo: true,
        },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
      });
    } catch (_) {
      // Por si el campo "nombre" tiene restricción unique
      local = await prisma.usuarios.create({
        data: {
          usuario_id: Number(institutoId),
          nombre: `${baseNombre}_${Number(institutoId)}`,
          apellido: String(apellidos || '').trim(),
          correo: correo || null,
          activo: true,
        },
        select: { usuario_id: true, nombre: true, apellido: true, correo: true, activo: true }
      });
    }
  } else {
    // Mantener datos frescos (sin bloquear si falla)
    try {
      await prisma.usuarios.update({
        where: { usuario_id: Number(institutoId) },
        data: {
          correo: correo || local.correo || null,
          apellido: String(apellidos || local.apellido || '').trim(),
          activo: true,
        },
      });
    } catch (_) {}
  }

  // 2) Asegurar rol asignado (Docente/Estudiante/etc) para permisos
  if (roleName) {
    try {
      const rol = await prisma.roles.findUnique({ where: { nombre: String(roleName) }, select: { rol_id: true } });
      if (rol?.rol_id) {
        await prisma.usuario_roles.create({ data: { usuario_id: Number(institutoId), rol_id: Number(rol.rol_id) } });
      }
    } catch (_) {
      // ignorar si ya existe o si el rol no está configurado
    }
  }

  return local;
}

function mapPerfilIdToRoleName(id) {
  const map = new Map([
    [1, 'Coordinador'],
    [10, 'Tesoreria'],
    [11, 'Secretaria'],
    [14, 'Estudiante'],
    [15, 'Docente'],
    [17, 'Coordinador'], // perfil alterno
    [18, 'Vicerrector'],
  ]);
  return map.get(Number(id)) || null;
}

async function login(email, secret) {
  // secret puede ser password (local) o cedula (Instituto)
  if (!email || !secret) {
    const err = new Error("email y password/cedula son requeridos");
    err.status = 400;
    throw err;
  }

  // LOGIN LOCAL (email + password)
  const localUser = await prisma.usuarios.findFirst({
    where: { correo: email },
    select: {
      usuario_id: true,
      nombre: true,
      apellido: true,
      correo: true,
      contrase_a_hash: true,
      activo: true,
      usuario_roles: { select: { roles: { select: { nombre: true } } } },
    },
  });

  let roles = [];
  let baseUser = null;

  if (localUser && localUser.activo && typeof localUser.contrase_a_hash === 'string' && localUser.contrase_a_hash.startsWith('$2')) {
    const ok = await comparePassword(secret, localUser.contrase_a_hash);
    if (ok) {
      roles = (localUser.usuario_roles || []).map(ur => ur.roles?.nombre).filter(Boolean);
      baseUser = { usuario_id: localUser.usuario_id, nombre: localUser.nombre, apellido: localUser.apellido, correo: localUser.correo };
    }
  }

  // Si no autenticó por local, intentar como Instituto (email + cedula)
  if (!baseUser) {
    const EXT_SCHEMA = process.env.INSTITUTO_SCHEMA || 'tecnologicolosan_sigala2';
    // Solo lectura al esquema del instituto
    const emailEsc = String(email).replace(/'/g, "''");
    const cedulaEsc = String(secret).replace(/'/g, "''");
    const sql = `SELECT ID_USUARIOS AS id, CORREO_USUARIOS AS correo, DOCUMENTO_USUARIOS AS cedula, ID_PERFILES_USUARIOS AS perfil, NOMBRES_USUARIOS AS nombres, APELLIDOS_USUARIOS AS apellidos FROM ${EXT_SCHEMA}.SEGURIDAD_USUARIOS WHERE CORREO_USUARIOS='${emailEsc}' AND DOCUMENTO_USUARIOS='${cedulaEsc}' AND (STATUS_USUARIOS='ACTIVO' OR STATUS_USUARIOS IS NULL)`;
    const rows = await prisma.$queryRawUnsafe(sql);
    const u = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!u) {
      const err = new Error("Credenciales inválidas");
      err.status = 401; throw err;
    }
    const extRole = mapPerfilIdToRoleName(u.perfil);

    // Asegurar usuario local con mismo ID del instituto para que:
    // - uic_asignaciones.tutor_usuario_id / lector_usuario_id coincidan con req.user.sub
    // - prisma.usuarios pueda resolver nombres
    await ensureLocalUserForInstituteUser({
      institutoId: Number(u.id),
      correo: u.correo || email,
      nombres: u.nombres,
      apellidos: u.apellidos,
      roleName: extRole,
    });

    if (extRole) roles.push(extRole);
    // Fusionar roles locales si existe un usuario local con ese correo
    if (localUser && localUser.activo) {
      const localRoles = (localUser.usuario_roles || []).map(ur => ur.roles?.nombre).filter(Boolean);
      roles = Array.from(new Set([...(roles || []), ...localRoles]));
    }

    // Importante: el "sub" del token debe ser el ID del instituto (ya existe como usuario_id local)
    baseUser = {
      usuario_id: Number(u.id),
      nombre: u.nombres || '',
      apellido: u.apellidos || '',
      correo: u.correo || email
    };
  }

  // Asegurar al menos un rol si el local tenía roles
  roles = Array.from(new Set(roles));

  const payload = {
    sub: baseUser.usuario_id || undefined,
    email: baseUser.correo,
    roles,
    name: `${baseUser.nombre} ${baseUser.apellido}`.trim(),
  };
  const token = sign(payload);

  return { token, user: { ...baseUser, roles } };
}

module.exports = { login };
