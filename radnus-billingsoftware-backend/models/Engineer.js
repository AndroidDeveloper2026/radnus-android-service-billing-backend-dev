const mongoose = require("mongoose");

const engineerSchema = new mongoose.Schema({
  name: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Engineer", engineerSchema);