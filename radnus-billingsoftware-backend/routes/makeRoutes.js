const express = require("express");
const router = express.Router();
const Make = require("../models/Make");

/* ================= ADD ================= */
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Make name required" });
    }

    const newMake = new Make({ name });
    await newMake.save();

    res.json({ success: true, data: newMake });

  } catch (err) {
    res.status(400).json({ message: "Make already exists ❌" });
  }
});

/* ================= GET ALL ================= */
router.get("/", async (req, res) => {
  try {
    const data = await Make.find().sort({ name: 1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error fetching makes" });
  }
});

/* ================= 🔍 SEARCH ================= */
router.get("/search/:name", async (req, res) => {
  try {
    const make = await Make.findOne({
      name: { $regex: req.params.name, $options: "i" }
    });

    if (!make) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json(make);

  } catch (err) {
    res.status(500).json({ message: "Search error" });
  }
});

/* ================= ✏ UPDATE ================= */
router.put("/:id", async (req, res) => {
  try {
    const { name } = req.body;

    const updated = await Make.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );

    res.json(updated);

  } catch (err) {
    res.status(500).json({ message: "Update failed ❌" });
  }
});

/* ================= 🗑 DELETE ================= */
router.delete("/:id", async (req, res) => {
  try {
    await Make.findByIdAndDelete(req.params.id);
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ message: "Delete failed ❌" });
  }
});

module.exports = router;