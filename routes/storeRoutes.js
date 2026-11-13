// routes/storeRoutes.js   (mounted at /api/stores, behind protect)
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Store = require("../models/Store");
const { authorize, GLOBAL_ROLES } = require("../middleware/authMiddleware");
const { clearStoreCache } = require("../utils/storeHelpers");

const pick = (s) => ({
  _id: s._id, name: s.name, code: s.code, jobPrefix: s.jobPrefix, city: s.city, isActive: s.isActive,
});

// LIST — admin/gm see every store (for the store switcher); everyone else just their own.
router.get("/", async (req, res) => {
  try {
    const filter = GLOBAL_ROLES.includes(req.user.role) ? {} : { _id: req.user.storeId };
    const stores = await Store.find(filter).sort({ createdAt: 1 }).lean();
    res.json(stores.map(pick));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE — admin only
router.post("/", authorize("admin"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "").trim().toUpperCase();
    const city = String(req.body.city || "").trim();
    if (!name) return res.status(400).json({ message: "Store name is required" });
    if (!/^[A-Z0-9]{2,6}$/.test(code)) {
      return res.status(400).json({ message: "Store code must be 2-6 letters/digits (e.g. CBE)" });
    }
    const jobPrefix = String(req.body.jobPrefix || `${code}-JS`).trim().toUpperCase();
    if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(jobPrefix)) {
      return res.status(400).json({ message: "Job prefix may only contain letters, digits and dashes" });
    }

    const store = await Store.create({ name, code, jobPrefix, city });
    clearStoreCache();
    res.json({ message: "Store created ✅", store: pick(store) });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "A store with this name, code or job prefix already exists" });
    res.status(500).json({ message: err.message });
  }
});

// UPDATE — admin only. code / jobPrefix are deliberately NOT editable (existing job numbers depend on them).
router.put("/:id", authorize("admin"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid store id" });
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body.city !== undefined) update.city = String(req.body.city).trim();
    if (req.body.isActive !== undefined) update.isActive = !!req.body.isActive;
    if (update.name === "") return res.status(400).json({ message: "Store name cannot be empty" });

    const store = await Store.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: "after" });
    if (!store) return res.status(404).json({ message: "Store not found" });
    clearStoreCache();
    res.json({ message: "Store updated ✅", store: pick(store) });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "A store with this name already exists" });
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;