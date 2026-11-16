const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const { adminOnly } = require("../middleware/roleMiddleware");

const router = express.Router();

const ACCESS = ["none", "with_billing", "only"];

// CREATE USER (admin only)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, username, password, role, feedbackAccess, linkedRep } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const finalRole = role || "user";
    const isUser = finalRole === "user";

    if (isUser && linkedRep) {
      const taken = await User.findOne({ linkedRep });
      if (taken) {
        return res.status(400).json({ message: `Rep "${linkedRep}" already linked to ${taken.username}` });
      }
    }

    const user = new User({
      name,
      username,
      password: hash,
      role: finalRole,
      feedbackAccess: isUser && ACCESS.includes(feedbackAccess) ? feedbackAccess : "none",
      linkedRep: isUser ? (linkedRep || "") : ""
    });
    await user.save();
    res.json({ message: "User created ✅" });
  } catch (err) {
    res.status(500).json({ message: "Error creating user" });
  }
});

// GET ALL USERS (admin only)
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find(
      {},
      { username: 1, role: 1, name: 1, feedbackAccess: 1, linkedRep: 1 }
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE feedback access / linked rep (admin only)
router.patch("/:id/access", protect, adminOnly, async (req, res) => {
  try {
    const { feedbackAccess, linkedRep } = req.body;
    const upd = {};

    if (feedbackAccess !== undefined) {
      if (!ACCESS.includes(feedbackAccess)) {
        return res.status(400).json({ message: "Invalid access value" });
      }
      upd.feedbackAccess = feedbackAccess;
    }

    if (linkedRep !== undefined) {
      if (linkedRep) {
        const taken = await User.findOne({ linkedRep, _id: { $ne: req.params.id } });
        if (taken) {
          return res.status(400).json({ message: `Rep "${linkedRep}" already linked to ${taken.username}` });
        }
      }
      upd.linkedRep = linkedRep;
    }

    await User.findByIdAndUpdate(req.params.id, upd);
    res.json({ message: "Updated ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE USER (admin only)
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;