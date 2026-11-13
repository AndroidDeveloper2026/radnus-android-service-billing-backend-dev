const express = require("express");
const router = express.Router();
const Engineer = require("../models/Engineer");
const { scope, requireStore, authorize } = require("../middleware/authMiddleware");

const canManage = authorize("admin", "storeManager");

// GET — only this store's engineers (admin/gm "all stores" view sees all)
router.get("/", async (req, res) => {
  try {
    const data = await Engineer.find({ ...scope(req) }).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADD
router.post("/", canManage, async (req, res) => {
  try {
    if (!requireStore(req, res)) return;
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Engineer name is required" });

    const doc = { name, storeId: req.storeId };
    if (req.body.type) doc.type = req.body.type;
    const newData = await Engineer.create(doc);
    res.json(newData);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "Engineer already exists in this store" });
    res.status(500).json({ message: err.message });
  }
});

// UPDATE — only name / type; storeId can never be changed from here
router.put("/:id", canManage, async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body.type !== undefined) update.type = req.body.type;
    const updated = await Engineer.findOneAndUpdate(
      { _id: req.params.id, ...scope(req) },
      { $set: update },
      { returnDocument: "after", runValidators: true }
    );
    if (!updated) return res.status(404).json({ message: "Engineer not found" });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "Engineer already exists in this store" });
    res.status(500).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", canManage, async (req, res) => {
  try {
    const removed = await Engineer.findOneAndDelete({ _id: req.params.id, ...scope(req) });
    if (!removed) return res.status(404).json({ message: "Engineer not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;