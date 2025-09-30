module.exports = function requireRole(allowedRoles = []) {
  return function (req, res, next) {
    try {
      const role = req.user && req.user.role;
      if (!role) {
        const err = new Error("No autorizado");
        err.status = 401;
        throw err;
      }
      if (!allowedRoles.includes(role)) {
        const err = new Error("Prohibido: rol insuficiente");
        err.status = 403;
        throw err;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};
