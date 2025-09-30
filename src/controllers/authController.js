const authService = require("../services/authService");
const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email({ message: "email inválido" }),
  password: z.string().min(6, { message: "password debe tener al menos 6 caracteres" }),
});

async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body || {});
    const result = await authService.login(email, password);
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
