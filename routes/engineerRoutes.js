const express = require("express");
const router = express.Router();
const Engineer = require("../models/Engineer");

// GET
router.get("/", async (req, res) => {
  const data = await Engineer.find().sort({ createdAt: -1 });
  res.json(data);
});

// ADD
router.post("/", async (req, res) => {
  const { name } = req.body;

  const newData = new Engineer({ name });
  await newData.save();

  res.json(newData);
});

// UPDATE
router.put("/:id", async (req, res) => {
  const updated = await Engineer.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );
  res.json(updated);
});

// DELETE
router.delete("/:id", async (req, res) => {
  await Engineer.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

module.exports = router;