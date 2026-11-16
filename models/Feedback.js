const mongoose = require("mongoose");

const AttemptSchema = new mongoose.Schema({
  status: String,                          // not_answered / busy / switched_off / wrong_number / callback
  at:     { type: Date, default: Date.now },
  by:     String,
  note:   String,
}, { _id: false });

const AnswerSchema = new mongoose.Schema({
  key: String,
  questionText: String,                    // snapshot: question maathinaalum history sariyaa irukkum
  type: String,
  answer: mongoose.Schema.Types.Mixed,
}, { _id: false });

const FeedbackSchema = new mongoose.Schema({
  jobSheet:    { type: mongoose.Schema.Types.ObjectId, ref: "JobSheet", required: true },
  jobSheetNo:  String,
  scenario:    { type: String, required: true },   // delivered / delivered_nrna / repaired / pending / cancelled
  statusAtCall: String,

  // snapshot (report ku)
  customerName: String, contact: String, phone: String,   // phone = last 10 digits
  isDealer: { type: Boolean, default: false },
  engineer: String, serviceRep: String, dealer: String,

    state: { type: String, enum: ["open", "done", "unreachable", "skipped", "internal"], default: "open" },
  skipReason: String,
  callAttempts: [AttemptSchema],
  nextCallAt: Date,
  doNotCall: { type: Boolean, default: false },

  spokeWith: { type: String, default: "customer" },
  answers: [AnswerSchema],
  rating: Number,
  comments: String,
  flags: [String],                                   // delivery_dispute, low_rating, ...
  followUp: { required: { type: Boolean, default: false }, note: String },

  collectedBy: { userId: String, name: String, username: String },
  collectedAt: Date,
}, { timestamps: true });

FeedbackSchema.index({ jobSheet: 1, scenario: 1 }, { unique: true });
FeedbackSchema.index({ phone: 1 });

module.exports = mongoose.model("Feedback", FeedbackSchema);