// models/Counter.js
// Atomic per-store job-sheet sequence. One doc per store: _id = "jobsheet:<storeId>".
// Using $inc on this doc is what makes two receptionists saving at the same
// moment get two DIFFERENT numbers (the old "fetch all, take max+1" approach
// handed both of them the same number and one save failed).
const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);