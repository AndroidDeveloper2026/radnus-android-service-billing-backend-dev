const Make = require("../models/Make");

// GET ALL
exports.getMakes = async (req, res) => {
  const data = await Make.find().sort({ name: 1 });
  res.json(data);
};

// ADD
exports.addMake = async (req, res) => {
  try {
    const make = new Make({ name: req.body.name });
    await make.save();
    res.json(make);
  } catch (err) {
    res.status(400).json({ message: "Already exists ❌" });
  }
};
