const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/meController");

// GET /me/profile
router.get("/me/profile", ctrl.profile);

module.exports = router;
