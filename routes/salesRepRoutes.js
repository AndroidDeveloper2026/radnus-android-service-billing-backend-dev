const express = require("express");
const router = express.Router();
const SalesRep = require("../models/SalesRep"); // now a real model file (was an inline schema here)
const { scope, requireStore, authorize } = require("../middleware/authMiddleware");

const canManage = authorize("admin", "storeManager");

// GET all (this store's reps)
router.get("/", async (req, res) => {
  try {
    const reps = await SalesRep.find({ ...scope(req) }).sort({ name: 1 });
    res.json(reps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE
router.post("/", canManage, async (req, res) => {
  try {
    if (!requireStore(req, res)) return;
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ message: "Name required" });
    const rep = await SalesRep.create({ name, storeId: req.storeId });
    res.json({ message: "Sales Rep added ✅", rep });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Sales Rep already exists" });
    }
    res.status(500).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", canManage, async (req, res) => {
  try {
    const removed = await SalesRep.findOneAndDelete({ _id: req.params.id, ...scope(req) });
    if (!removed) return res.status(404).json({ message: "Sales Rep not found" });
    res.json({ message: "Deleted ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;