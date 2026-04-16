const express = require("express");
const router = express.Router();
const Drawer = require("../models/Drawer");

// GET
router.get("/", async (req, res) => {
  const data = await Drawer.find().sort({ createdAt: -1 });
  res.json(data);
});

// ADD
router.post("/", async (req, res) => {
  const { name } = req.body;

  const newDrawer = new Drawer({ name });
  await newDrawer.save();

  res.json(newDrawer);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const updated = await Drawer.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );

  res.json(updated);
});

// DELETE
router.delete("/:id", async (req, res) => {
  await Drawer.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

module.exports = router;