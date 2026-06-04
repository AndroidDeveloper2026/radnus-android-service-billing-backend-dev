const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");

const router = express.Router();

// CREATE USER
router.post("/", async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      username,
      password: hash,
      role: role || "user"
    });
    await user.save();
    res.json({ message: "User created ✅" });
  } catch (err) {
    res.status(500).json({ message: "Error creating user" });
  }
});

// GET ALL USERS
router.get("/", async (req, res) => {
  try {
    const users = await User.find({}, { username: 1, role: 1, name: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE USER
router.delete("/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;