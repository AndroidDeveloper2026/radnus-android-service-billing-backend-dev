// models/SalesRep.js
// Moved out of routes/salesRepRoutes.js (it was an inline schema there) so the
// migration script and other files can share the same model. Now per-store.
const mongoose = require("mongoose");

const salesRepSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", index: true },
  },
  { timestamps: true }
);

// Same rep name is allowed in different stores, but not twice in one store.
salesRepSchema.index({ storeId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.SalesRep || mongoose.model("SalesRep", salesRepSchema);