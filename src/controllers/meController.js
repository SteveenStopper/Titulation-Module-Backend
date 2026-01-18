const meService = require("../services/meService");

async function profile(req, res, next) {
  try {
    const id_user = req.user?.sub;
    if (!id_user) {
      const err = new Error("No autorizado");
      err.status = 401;
      throw err;
    }
    const data = await meService.getProfile(id_user);
    // Deshabilitar caché para evitar 304 y reintentos en el cliente
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.status(200).json(data || {});
  } catch (err) {
    next(err);
  }
}

module.exports = { profile };
