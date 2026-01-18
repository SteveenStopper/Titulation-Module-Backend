const jwt = require("jsonwebtoken");

let warned = false;
function getSecret() {
  const secret = process.env.JWT_SECRET || "__DEV_ONLY_CHANGE_ME__";
  if (!process.env.JWT_SECRET && !warned) {
    // Aviso solo una vez en consola para entornos de desarrollo
    console.warn("[jwt] JWT_SECRET no definido. Usando secreto por defecto solo para desarrollo.");
    warned = true;
  }
  return secret;
}

const DEFAULT_EXP = "2h";

function sign(payload, options = {}) {
  const secret = getSecret();
  const exp = options.expiresIn || DEFAULT_EXP;
  return jwt.sign(payload, secret, { expiresIn: exp });
}

function verify(token) {
  const secret = getSecret();
  return jwt.verify(token, secret);
}

module.exports = { sign, verify };
