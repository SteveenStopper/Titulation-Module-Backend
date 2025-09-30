const express = require("express");
const router = express.Router();
const modalityController = require("../controllers/modalityController");

// GET /modality?title=&career=&professor=&id_user=&page=&pageSize=
router.get("/", modalityController.list);
router.get("/:id", modalityController.getById); // GET /modality/:id
router.post("/", modalityController.create); // POST /modality
router.put("/:id", modalityController.update); // PUT /modality/:id
router.delete("/:id", modalityController.remove); // DELETE /modality/:id

module.exports = router;
