const mongoose = require("mongoose");

const FeedbackQuestionSchema = new mongoose.Schema({
  scenario: { type: String, required: true,
    enum: ["delivered", "delivered_nrna", "repaired", "pending", "cancelled"] },
  key:      { type: String, required: true },         // stable id: "received", "fixed", "overall"
  text:     { type: String, required: true },
  type:     { type: String, enum: ["rating", "yesno", "choice", "text"], default: "yesno" },
  options:  [String],                                  // choice type ku
  required: { type: Boolean, default: false },
  order:    { type: Number, default: 0 },
  active:   { type: Boolean, default: true },

  // Indha question vera oru answer match aanaa mattum kaattu (branching)
  showIf:  { key: String, value: String },

  // Indha answer vandha auto flag
  flagKey: String,
  flagIf:  { op: { type: String, enum: ["eq", "lte"] }, value: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

FeedbackQuestionSchema.index({ scenario: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("FeedbackQuestion", FeedbackQuestionSchema);