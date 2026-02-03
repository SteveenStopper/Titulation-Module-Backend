const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/settingsController");
const authorize = require("../middlewares/authorize");

router.get("/settings/active-period", ctrl.getActivePeriod);
router.put("/settings/active-period", ctrl.setActivePeriod);
router.get("/settings/periods", ctrl.listPeriods);
router.get("/settings/institute-periods", ctrl.listInstitutePeriods);

// Alias para compatibilidad si el router de settings se monta en "/settings"
router.get("/institute-periods", ctrl.listInstitutePeriods);
router.post("/settings/periods", ctrl.createPeriod);
// Editar/Cerrar periodos y limpiar activo
router.put("/settings/periods/:id", authorize('Administrador','Coordinador'), ctrl.updatePeriod);
router.post("/settings/periods/:id/close", authorize('Administrador','Coordinador'), ctrl.closePeriod);
router.delete("/settings/active-period", authorize('Administrador','Coordinador'), ctrl.clearActivePeriod);
// Feature flags (habilitaciones)
router.get("/settings/feature-flags", ctrl.getFeatureFlags);
router.put("/settings/feature-flags", ctrl.setFeatureFlags);
// Admin stats
router.get("/settings/admin-stats", authorize('Administrador','Coordinador'), ctrl.getAdminStats);

module.exports = router;
