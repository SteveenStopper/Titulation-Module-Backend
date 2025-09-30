// Error handling middleware
module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";

  // Zod validation errors
  if (err && err.name === "ZodError" && Array.isArray(err.errors)) {
    const errors = err.errors.map((e) => ({
      path: Array.isArray(e.path) ? e.path.join(".") : String(e.path || ""),
      message: e.message,
    }));
    return res.status(400).json({ errors });
  }

  // Prisma known errors: add more mappings if needed
  // P2002: Unique constraint failed
  if (err.code === "P2002" && status === 500) {
    return res.status(409).json({ error: "Valor duplicado para un campo único" });
  }

  // Multer: tamaño excedido
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Archivo demasiado grande" });
  }

  // Errores de validación comunes
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: message });
  }

  // Logging de errores
  if (req && req.log) {
    req.log.error({ status, message, name: err.name, code: err.code }, "error");
  } else {
    console.error(`[Error ${status}]`, message);
  }

  res.status(status).json({ error: message });
};
