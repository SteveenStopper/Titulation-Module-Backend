const { verify } = require("../utils/jwt");

module.exports = function auth(req, res, next) {
  try {
    const header = req.headers["authorization"] || req.headers["Authorization"];
    if (!header || !header.startsWith("Bearer ")) {
      const err = new Error("No autorizado");
      err.status = 401;
      throw err;
    }
    const token = header.slice("Bearer ".length).trim();
    const decoded = verify(token);
    req.user = decoded; // { sub, email, role, name, iat, exp }
    next();
  } catch (err) {
    err.status = err.status || 401;
    err.message = err.message || "Token inválido";
    next(err);
  }
};
