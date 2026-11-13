const express = require("express");
const router = express.Router();
const Drawer = require("../models/Drawer");
const { scope, requireStore } = require("../middleware/authMiddleware");

// GET — this store's drawers
router.get("/", async (req, res) => {
  try {
    const data = await Drawer.find({ ...scope(req) }).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADD (reception can add drawers — same as before)
router.post("/", async (req, res) => {
  try {
    if (!requireStore(req, res)) return;
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Drawer name is required" });
    const newDrawer = await Drawer.create({ name, storeId: req.storeId });
    res.json(newDrawer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    const updated = await Drawer.findOneAndUpdate(
      { _id: req.params.id, ...scope(req) },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(404).json({ message: "Drawer not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const removed = await Drawer.findOneAndDelete({ _id: req.params.id, ...scope(req) });
    if (!removed) return res.status(404).json({ message: "Drawer not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;