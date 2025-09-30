const express = require("express");
const router = express.Router();
const usersController = require("../controllers/usersController");


router.get("/", usersController.list); // GET /users?activeOnly=true
router.get("/:id", usersController.getById); // GET /users/:id
router.post("/", usersController.create); // POST /users
router.put("/:id", usersController.update); // PUT /users/:id
router.delete("/:id", usersController.remove); // DELETE /users/:id (soft delete)

module.exports = router;
