// routes/userRoutes.js   (mounted at /api/users, behind protect + blockGmWrites)
// BEFORE: no auth at all — anyone who knew the URL could create an admin account or delete users.
const express = require("express");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../models/User");
const { authorize, invalidateUser, GLOBAL_ROLES } = require("../middleware/authMiddleware");
const { getStoreById } = require("../utils/storeHelpers");

const ROLES = User.ROLES;
const MANAGER_CAN_MANAGE = ["user", "engineer"]; // what a Store Manager may create / edit / delete
const MIN_PASSWORD = 6;

// Work out which storeId a user should get, enforcing the rules for who may do what.
// Returns { error, status } or { storeId }.
async function resolveRoleAndStore(actor, req, role, bodyStoreId) {
  if (!ROLES.includes(role)) return { status: 400, error: "Invalid role" };

  if (actor.role === "storeManager") {
    if (!MANAGER_CAN_MANAGE.includes(role)) return { status: 403, error: "Store Managers can only manage User and Engineer accounts" };
    return { storeId: actor.storeId };
  }

  // actor is admin
  if (GLOBAL_ROLES.includes(role)) return { storeId: null };
  const storeId = bodyStoreId || req.storeId;
  if (!storeId || !mongoose.isValidObjectId(storeId)) return { status: 400, error: "Select a store for this user" };
  if (!(await getStoreById(storeId))) return { status: 400, error: "Store not found" };
  return { storeId };
}

// LIST
router.get("/", authorize("admin", "gm", "storeManager"), async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === "storeManager") {
      filter.storeId = req.user.storeId;
      filter.role = { $in: MANAGER_CAN_MANAGE };
      } else if (req.storeId && req.query.all !== "1") {
      // admin / gm with a store selected see that store's users;
      // ?all=1 (User List screen) shows everyone, incl. users with no store yet
      filter.storeId = req.storeId;
    }
    const users = await User.find(filter, { username: 1, role: 1, name: 1, storeId: 1 })
      .populate("storeId", "name code")
      .lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE
router.post("/", authorize("admin", "storeManager"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role || "user";

    if (!name || !username || !password) return res.status(400).json({ message: "Name, username and password are required" });
    if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });

    const r = await resolveRoleAndStore(req.user, req, role, req.body.storeId);
    if (r.error) return res.status(r.status).json({ message: r.error });

    const hash = await bcrypt.hash(password, 10);
    await User.create({ name, username, password: hash, role, storeId: r.storeId });
    res.json({ message: "User created ✅" });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "Username already exists" });
    console.error("CREATE USER ERROR:", err);
    res.status(500).json({ message: "Error creating user" });
  }
});

// EDIT (name / role / store / reset password)
router.put("/:id", authorize("admin", "storeManager"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "User not found" });

    if (req.user.role === "storeManager") {
      const inMyStore = String(target.storeId || "") === req.user.storeId;
      if (!inMyStore || !MANAGER_CAN_MANAGE.includes(target.role)) {
        return res.status(403).json({ message: "You can only edit User / Engineer accounts of your own store" });
      }
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: "Name cannot be empty" });
      target.name = name;
    }

    if (req.body.role !== undefined || req.body.storeId !== undefined) {
      const newRole = req.body.role || target.role;
      if (String(target._id) === req.user.userId && newRole !== target.role) {
        return res.status(400).json({ message: "You cannot change your own role" });
      }
      const r = await resolveRoleAndStore(req.user, req, newRole, req.body.storeId || (target.storeId && String(target.storeId)));
      if (r.error) return res.status(r.status).json({ message: r.error });
      target.role = newRole;
      target.storeId = r.storeId;
    }

    if (req.body.password) {
      const pw = String(req.body.password);
      if (pw.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
      target.password = await bcrypt.hash(pw, 10);
    }

    await target.save();
    invalidateUser(target._id);
    res.json({ message: "User updated ✅" });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", authorize("admin", "storeManager"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid user id" });
    if (req.params.id === req.user.userId) return res.status(400).json({ message: "You cannot delete your own account" });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "User not found" });

    if (req.user.role === "storeManager") {
      const inMyStore = String(target.storeId || "") === req.user.storeId;
      if (!inMyStore || !MANAGER_CAN_MANAGE.includes(target.role)) {
        return res.status(403).json({ message: "You can only delete User / Engineer accounts of your own store" });
      }
    }

    await target.deleteOne();
    invalidateUser(target._id); // locks them out immediately, not when their token expires
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;