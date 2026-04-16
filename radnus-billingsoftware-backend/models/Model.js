const mongoose = require("mongoose");

const modelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  make: { type: String, required: true } // 🔥 relation
}, { timestamps: true });

module.exports = mongoose.model("Model", modelSchema);
