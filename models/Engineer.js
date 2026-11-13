// models/Engineer.js
const mongoose = require("mongoose");

const engineerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  type: { type: String, enum: ["Hardware", "Software", "Both"], default: "Hardware" }, // NEW
}, { timestamps: true });

module.exports = mongoose.model("Engineer", engineerSchema);