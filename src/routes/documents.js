const express = require("express");
const router = express.Router();
const documentsController = require("../controllers/documentsController");
const upload = require("../middlewares/upload");
const setUploadDir = require("../middlewares/setUploadDir");

// GET /documents?doc_type=&id_user=&page=&pageSize=
router.get("/", documentsController.list);
router.get("/:id", documentsController.getById); // GET /documents/:id
router.get("/:id/download", documentsController.download); // GET /documents/:id/download
router.post("/", setUploadDir, upload.single("file"), documentsController.create); // POST /documents (con archivo por subcarpeta)
// Actualizar solo estado/observación sin archivo
router.patch("/:id/status", documentsController.setStatus);
router.put("/:id", setUploadDir, upload.single("file"), documentsController.update); // PUT /documents/:id (con archivo por subcarpeta)
router.delete("/:id", documentsController.remove); // DELETE /documents/:id
router.get("/checklist/user", documentsController.checklist); // GET /documents/checklist/user?id_user=&modality=

module.exports = router;
