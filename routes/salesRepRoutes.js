const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// ── Inline Schema (separate model file தேவையில்ல) ──
let SalesRep;
try {
  SalesRep = mongoose.model("SalesRep");
} catch {
  SalesRep = mongoose.model("SalesRep", new mongoose.Schema({
    name: { type: String, unique: true, required: true, trim: true },
  }, { timestamps: true }));
}

// GET all
router.get("/", async (req, res) => {
  try {
    const reps = await SalesRep.find().sort({ name: 1 });
    res.json(reps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE
router.post("/", async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ message: "Name required" });
    const rep = new SalesRep({ name });
    await rep.save();
    res.json({ message: "Sales Rep added ✅", rep });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: "Sales Rep already exists" });
    }
    res.status(500).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    await SalesRep.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;