const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/notificationsController");
const authorize = require("../middlewares/authorize");

router.get("/", ctrl.listMy);
router.put("/:id/read", ctrl.markRead);
router.put("/read-all", ctrl.markAllRead);
router.post("/", ctrl.create);
// Admin: notificaciones recientes globales
router.get("/admin/recent", authorize('Administrador','Coordinador'), ctrl.listRecentAdmin);

module.exports = router;
