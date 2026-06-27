const mongoose = require("mongoose");

const SpareItemSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  rate: Number,
  amount: Number
});
// இதை ADD பண்ணு:
const AdvanceItemSchema = new mongoose.Schema({
  label:  { type: String, default: "" },  // ✅
  amount: { type: Number, default: 0 },
  date:   { type: Date }
});
const StatusLogSchema = new mongoose.Schema({
  status:    String,
  updatedBy: String,
  timestamp: { type: Date, default: Date.now }
});

const RepairStepSchema = new mongoose.Schema({
  step:        String,
  note:        String,
  done:        { type: Boolean, default: false },
  completedBy: String,
  completedAt: Date,
});

const TransferLogSchema = new mongoose.Schema({
  from:          String,
  to:            String,
  note:          String,
  transferredAt: { type: Date, default: Date.now }
});

// ✅ NEW — Rebill history snapshot
const RebillHistorySchema = new mongoose.Schema({
  rebilledAt:    { type: Date,   default: Date.now },
  rebilledBy:    { type: String, default: "admin"  },
  serviceCharge: { type: Number, default: 0 },
  spareCharge:   { type: Number, default: 0 },
  spareItems:    { type: Array,  default: [] },
  remarks:       { type: String, default: "" },
  status:        { type: String, default: "" },
  rebillPending: { type: Boolean, default: false }
});

const JobSheetSchema = new mongoose.Schema({
  jobSheetNo: { type: String, unique: true },

  customer: {
    name: String, contact: String, altContact: String,
    address: String, email: String,
  },

  device: {
    make: String, model: String, imei: String,
    warranty: String, pattern: String, mobileStatus: String,
  },

  physicalCondition: [String],
  accessories:       [String],
  visualIssues:      [String],

  idProofType:  String,
  idProofImage: { url: String, public_id: String },
service: {
    engineer: String, dealer: String, drawer: String,
     
    serviceCharge: Number, spareCharge: Number,
    estimate: String, paymentMode: String,
    repairDate: Date, deliveryDate: Date, 
    remarks: String,
    advanceAmount: { type: Number, default: 0 },
   advanceItems: { type: [AdvanceItemSchema], default: [] },

    margin:        { type: Number, default: 0 },
    serviceRep:    { type: String, default: "" },   // ✅ NEW

instaFollowers: { type: String, default: "" },   
googleReview:   { type: String, default: "" },   
  },
  spareItems: [SpareItemSchema],

  statusLogs:  [StatusLogSchema],
  repairSteps: [RepairStepSchema],


  transferLog: [TransferLogSchema],

  // ✅ NEW — stores each previous invoice before rebill
  rebillHistory: [RebillHistorySchema],

  createdBy: { username: String, role: String },
isCancelled:   { type: Boolean, default: false },
cancelRemarks: { type: String,  default: "" },
cancelledBy:   { type: String,  default: "" },
cancelledAt:   { type: Date },
  
  isInvoiced:    { type: Boolean, default: false },
rebillPending: { type: Boolean, default: false },  // ✅ இதை add பண்ணு

}, { timestamps: true });

module.exports = mongoose.model("JobSheet", JobSheetSchema);