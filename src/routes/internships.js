const express = require("express");
const router = express.Router();
const internshipsController = require("../controllers/internshipsController");

// GET /internships?type=&id_user=&page=&pageSize=
router.get("/", internshipsController.list);
router.get("/:id", internshipsController.getById); // GET /internships/:id
router.post("/", internshipsController.create); // POST /internships
router.put("/:id", internshipsController.update); // PUT /internships/:id
router.delete("/:id", internshipsController.remove); // DELETE /internships/:id

module.exports = router;
