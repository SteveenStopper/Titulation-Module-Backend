const jwt = require("jsonwebtoken");

const DEFAULT_EXP = "2h";

function sign(payload, options = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET en variables de entorno");
  const exp = options.expiresIn || DEFAULT_EXP;
  return jwt.sign(payload, secret, { expiresIn: exp });
}

function verify(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Falta JWT_SECRET en variables de entorno");
  return jwt.verify(token, secret);
}

module.exports = { sign, verify };
