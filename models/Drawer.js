const mongoose = require("mongoose");

const drawerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", index: true },
}, { timestamps: true });

module.exports = mongoose.model("Drawer", drawerSchema);