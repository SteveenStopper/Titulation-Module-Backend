const express = require("express");
const router = express.Router();
const vouchersController = require("../controllers/vouchersController");
const setVoucherUploadDir = require("../middlewares/setVoucherUploadDir");
const uploadVoucher = require("../middlewares/uploadVoucher");

// GET /vouchers?v_type=&id_user=&page=&pageSize=
router.get("/", vouchersController.list);

// GET /vouchers/:id
router.get("/:id", vouchersController.getById);

// POST /vouchers
router.post("/", setVoucherUploadDir, uploadVoucher.single("file"), vouchersController.create);

// PUT /vouchers/:id
router.put("/:id", setVoucherUploadDir, uploadVoucher.single("file"), vouchersController.update);

// DELETE /vouchers/:id
router.delete("/:id", vouchersController.remove);

module.exports = router;
