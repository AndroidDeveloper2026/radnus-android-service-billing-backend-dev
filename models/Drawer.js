const mongoose = require("mongoose");

const drawerSchema = new mongoose.Schema({
  name: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Drawer", drawerSchema);