const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/externalController");

// GET /external/health
router.get("/health", ctrl.health);

// GET /external/grades?externalUserId=&academicPeriodId=&viewName=
router.get("/grades", ctrl.grades);

module.exports = router;
