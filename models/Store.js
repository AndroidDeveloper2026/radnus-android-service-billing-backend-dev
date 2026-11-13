// models/Store.js
// One document per physical store/branch. Every store-scoped collection
// (JobSheet, User, Engineer, Drawer, SalesRep) points back here via storeId.
const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    // Short code, e.g. "PDY", "CBE". Used to build the default job-sheet prefix.
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    // Job sheet numbers look like `${jobPrefix}-001`.
    // The ORIGINAL store keeps "JS" so existing numbers (JS-810 ...) never change.
    // New stores default to `${code}-JS` (e.g. CBE-JS-001).
    jobPrefix: { type: String, required: true, trim: true, uppercase: true, unique: true },
    city: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);