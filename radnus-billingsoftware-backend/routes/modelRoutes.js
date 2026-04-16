const express = require("express");
const router = express.Router();
const Model = require("../models/Model");


// ================= CREATE =================
router.post("/", async (req, res) => {
  try {
    const { name, make } = req.body;

    if (!name || !make) {
      return res.status(400).json({ message: "All fields required" });
    }

    const exist = await Model.findOne({ name, make });

    if (exist) {
      return res.status(400).json({ message: "Model already exists ❌" });
    }

    const model = new Model({ name, make });
    await model.save();

    res.json({ success: true, data: model });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= SEARCH =================
router.get("/search/:name", async (req, res) => {
  try {
    const model = await Model.findOne({
      name: { $regex: req.params.name, $options: "i" }
    });

    if (!model) {
      return res.status(404).json({ message: "Model not found ❌" });
    }

    res.json(model);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= UPDATE =================
router.put("/:id", async (req, res) => {
  try {
    const { name, make } = req.body;

    const updated = await Model.findByIdAndUpdate(
      req.params.id,
      { name, make },
      { new: true }
    );

    res.json({ success: true, data: updated });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= DELETE =================
router.delete("/:id", async (req, res) => {
  try {
    await Model.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: "Deleted ✅" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= GET BY MAKE =================
router.get("/:make", async (req, res) => {
  try {
    const models = await Model.find({ make: req.params.make });
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;