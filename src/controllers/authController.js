const authService = require("../services/authService");
const { z } = require("zod");

// Permitir login unificado:
// - Local: email + password
// - Instituto: email + cedula (solo lectura)
const loginSchema = z.object({
  email: z.string().email({ message: "email inválido" }),
  password: z.string().min(1).optional(),
  cedula: z.string().min(1).optional(),
}).refine((d) => !!(d.password || d.cedula), {
  message: "Debe enviar password o cedula",
});

async function login(req, res, next) {
  try {
    const parsed = loginSchema.parse(req.body || {});
    const secret = parsed.cedula ?? parsed.password;
    const result = await authService.login(parsed.email, secret);
    res.json(result);
  } catch (err) {
    if (err.name === "ZodError") {
      err.status = 400;
      err.message = err.errors.map((e) => e.message).join(", ");
    }
    next(err);
  }
}

module.exports = { login };
