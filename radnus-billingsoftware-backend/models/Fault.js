const mongoose = require("mongoose");

const faultSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("Fault", faultSchema);