module.exports = function authorize(...allowedRoles) {
  const allowed = new Set((allowedRoles || []).map(String));
  return function (req, res, next) {
    try {
      const user = req.user || {};
      // Support single role (string) or multiple roles (array)
      const roles = Array.isArray(user.roles)
        ? user.roles.map(String)
        : (user.role ? [String(user.role)] : []);
      // Admin bypass if present
      const hasAdmin = roles.includes('Administrador') || roles.includes('Admin') || roles.includes('ADMIN');
      if (hasAdmin) return next();
      if (allowed.size === 0) return next();
      const ok = roles.some(r => allowed.has(r));
      if (!ok) {
        const err = new Error('No autorizado: rol insuficiente');
        err.status = 403; throw err;
      }
      next();
    } catch (err) {
      err.status = err.status || 403;
      next(err);
    }
  };
}
