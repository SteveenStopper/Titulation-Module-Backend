const prisma = require("../../prisma/client");
const { comparePassword } = require("../utils/password");
const { sign } = require("../utils/jwt");

async function login(email, password) {
  if (!email || !password) {
    const err = new Error("email y password son requeridos");
    err.status = 400;
    throw err;
  }

  const user = await prisma.users.findUnique({
    where: { email },
    select: {
      id_user: true,
      firstname: true,
      lastname: true,
      email: true,
      password: true,
      is_active: true,
      id_rol: true,
    },
  });

  if (!user || !user.is_active) {
    const err = new Error("Credenciales inválidas");
    err.status = 401;
    throw err;
  }

  const ok = await comparePassword(password, user.password);
  if (!ok) {
    const err = new Error("Credenciales inválidas");
    err.status = 401;
    throw err;
  }

  const payload = {
    sub: user.id_user,
    email: user.email,
    role: user.id_rol,
    name: `${user.firstname} ${user.lastname}`,
  };
  const token = sign(payload);

  const { password: _, ...safeUser } = user;
  return { token, user: safeUser };
}

module.exports = { login };
