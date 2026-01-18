const express = require("express");
const router = express.Router();
const vouchersController = require("../controllers/vouchersController");
const setVoucherUploadDir = require("../middlewares/setVoucherUploadDir");
const uploadVoucher = require("../middlewares/uploadVoucher");
const authorize = require("../middlewares/authorize");

// GET /vouchers?v_type=&id_user=&page=&pageSize=
// sin authorize: el controller fuerza owner salvo roles de revisión
router.get("/", vouchersController.list);

// GET /vouchers/:id
router.get("/:id", vouchersController.getById);

// GET /vouchers/:id/download
router.get("/:id/download", vouchersController.download);

// POST /vouchers (owner o roles: Secretaria/Tesoreria/Administrador)
router.post("/", setVoucherUploadDir, uploadVoucher.single("file"), vouchersController.create);

// PUT /vouchers/:id (owner o roles: Secretaria/Tesoreria/Administrador)
router.put("/:id", setVoucherUploadDir, uploadVoucher.single("file"), vouchersController.update);

// DELETE /vouchers/:id (owner o roles: Secretaria/Tesoreria/Administrador)
router.delete("/:id", vouchersController.remove);

// PUT /vouchers/:id/approve
router.put("/:id/approve", authorize('Secretaria', 'Tesoreria', 'Administrador'), vouchersController.approve);

// PUT /vouchers/:id/reject
router.put("/:id/reject", authorize('Secretaria', 'Tesoreria', 'Administrador'), vouchersController.reject);

module.exports = router;
