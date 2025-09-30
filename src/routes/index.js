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
router.use("/documents", require("./documents"));
router.use("/vouchers", require("./vouchers"));
router.use("/modality", require("./modality"));
router.use("/internships", require("./internships"));

module.exports = router;