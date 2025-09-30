const express = require("express");
const router = express.Router();
const rolesController = require("../controllers/rolesController");


router.get("/", rolesController.list); // GET /roles?activeOnly=true
router.get("/:id", rolesController.getById); // GET /roles/:id
router.post("/", rolesController.create); // POST /roles
router.put("/:id", rolesController.update); // PUT /roles/:id
router.delete("/:id", rolesController.remove); // DELETE /roles/:id (soft delete)

module.exports = router;
