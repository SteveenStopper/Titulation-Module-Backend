const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");

// Subrouters
router.use("/health", require("./health"));
router.use("/auth", require("./auth"));
// A partir de aquí, todo requiere JWT
router.use(auth);
router.use("/users", require("./users"));
router.use("/roles", require("./roles"));
router.use("/", require("./me"));
router.use("/", require("./settings"));
router.use("/documents", require("./documents"));
router.use("/vouchers", require("./vouchers"));
router.use("/internships", require("./internships"));
router.use("/english", require("./english"));
router.use("/vinculacion", require("./vinculacion"));
router.use("/practicas", require("./practicas"));
router.use("/clearances", require("./clearances"));
router.use("/enrollments", require("./enrollments"));
router.use("/uic", require("./uic"));
router.use("/complexivo", require("./complexivo"));
router.use("/complexivo", require("./complexivoExtra"));
router.use("/secretaria", require("./secretaria"));
router.use("/tesoreria", require("./tesoreria"));
router.use("/cronogramas", require("./cronogramas"));
router.use("/tribunal", require("./tribunal"));
router.use("/notifications", require("./notifications"));
router.use("/docente", require("./docente"));
router.use("/vicerrector", require("./vicerrector"));

module.exports = router;