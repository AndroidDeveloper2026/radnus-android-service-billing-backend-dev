const express = require("express");
const router = express.Router();
const Fault = require("../models/Fault");

// GET all faults
router.get("/", async (req, res) => {
  const data = await Fault.find().sort({ createdAt: -1 });
  res.json(data);
});

// ADD fault
router.post("/", async (req, res) => {
  const { name, price } = req.body;

  const newFault = new Fault({ name, price });
  await newFault.save();

  res.json(newFault);
});

// UPDATE fault
router.put("/:id", async (req, res) => {
  const updated = await Fault.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true }
  );

  res.json(updated);
});

// DELETE fault
router.delete("/:id", async (req, res) => {
  await Fault.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

module.exports = router;