const mongoose = require("mongoose");

const FeedbackExcludeSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },   // last 10 digits
  customerName: String,
  reason: { type: String, default: "Internal / Staff" },
  addedBy: { userId: String, name: String, username: String },
}, { timestamps: true });

module.exports = mongoose.model("FeedbackExclude", FeedbackExcludeSchema);