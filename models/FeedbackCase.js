const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({ userId: String, name: String, username: String }, { _id: false });

const MessageSchema = new mongoose.Schema({
  kind: { type: String, enum: ["remark", "reply", "note", "system"], default: "note" },
  by: { userId: String, name: String, role: String },     // role: feedback / rep / admin
  text: String,
  outcome: String,                                         // reply ku mattum
  at: { type: Date, default: Date.now },
}, { _id: false });

const FeedbackCaseSchema = new mongoose.Schema({
  caseNo: { type: Number, index: true },
  type: { type: String, default: "delivery_dispute" },

  jobSheet: { type: mongoose.Schema.Types.ObjectId, ref: "JobSheet", required: true },
  jobSheetNo: String,
  feedback: { type: mongoose.Schema.Types.ObjectId, ref: "Feedback" },
  customerName: String,
  contact: String,
  serviceRep: String,                       // job la irundha rep peyar (snapshot)

  createdBy: PersonSchema,                  // feedback employee
  assignedTo: PersonSchema,                 // rep user (null na admin)
  routedTo: { type: String, enum: ["rep", "admin"], default: "rep" },
  routeNote: String,

  status: { type: String, enum: ["open", "seen", "resolved", "closed"], default: "open" },
  outcome: String,
  escalated: { type: Boolean, default: false },
  messages: [MessageSchema],

  seenAt: Date, resolvedAt: Date, closedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("FeedbackCase", FeedbackCaseSchema);