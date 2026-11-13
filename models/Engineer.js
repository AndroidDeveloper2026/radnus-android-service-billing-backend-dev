// models/Engineer.js
const mongoose = require("mongoose");

const engineerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ["Hardware", "Software", "Both"], default: "Hardware" }, // NEW
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", index: true },
}, { timestamps: true });

// Was `unique: true` on name alone — that would stop store B from having its own "Ajith".
// Now unique per store. ⚠️ Run scripts/migrateToMultiStore.js once: it drops the old `name_1` index.
engineerSchema.index({ storeId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Engineer", engineerSchema);