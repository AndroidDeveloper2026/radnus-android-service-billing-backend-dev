const mongoose = require("mongoose");

const SpareItemSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  rate: Number,
  amount: Number,
  date: { type: Date },
  isReturned:   { type: Boolean, default: false },
  returnDate:   { type: Date,    default: null },
  returnReason: { type: String,  default: "" },
  
  source: { type: String, enum: ["market", "raw"], default: "market" },
 //job sheet scehama
  syncedReturn: { type: Boolean, default: false },
});
// இதை ADD பண்ணு:
const AdvanceItemSchema = new mongoose.Schema({
  label:  { type: String, default: "" },  // ✅
  amount: { type: Number, default: 0 },
  date:   { type: Date }
});
const OthersItemSchema = new mongoose.Schema({
  category: String,
  amount:   Number,
  date:     Date
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

// 🔴 EXPANDED — this is now the full "before rebill" snapshot. Every billing AND
// assignment field that existed at the moment Rebill was clicked gets captured
// here, so the Rebill Report can show exactly what a past cycle looked like —
// not just income/service/spare like before, but also balance, raw spare,
// payment mode, and who/when it was assigned to for that cycle.
const RebillHistorySchema = new mongoose.Schema({
  rebilledAt:    { type: Date,   default: Date.now },
  rebilledBy:    { type: String, default: "admin"  },
  income:        { type: Number, default: 0 },
  incomeDate:    { type: Date },
  balance:       { type: Number, default: 0 },
  balanceDate:   { type: Date, default: null },
  serviceCharge: { type: Number, default: 0 },
  spareCharge:   { type: Number, default: 0 },
  rawSpareCharge: { type: Number, default: 0 },   // ✅ NEW — Raw Spare total at rebill time
  othersAmount:  { type: Number, default: 0 },
  advanceAmount: { type: Number, default: 0 },
  paymentMode:   { type: String, default: "" },   // ✅ NEW
  engineer:      { type: String, default: "" },   // ✅ NEW — record only, not reset
  drawer:        { type: String, default: "" },   // ✅ NEW — record only, not reset
  dealer:        { type: String, default: "" },   // ✅ NEW — record only, not reset
  serviceRep:    { type: String, default: "" },   // ✅ NEW — record only, not reset
  repairDate:    { type: Date },                  // ✅ NEW — record only, not reset
  deliveryDate:  { type: Date },                  // ✅ NEW — record only, not reset
  spareItems:    { type: Array,  default: [] },
  remarks:       { type: String, default: "" },
  status:        { type: String, default: "" },
  rebillPending: { type: Boolean, default: false }
});

const JobSheetSchema = new mongoose.Schema({
  jobSheetNo: { type: String, unique: true },

  customer: {
    name: String, contact: String, altContact: String,
    address: String, email: String,  district: String,   
  taluk: String,
  },


  device: {
    make: String, model: String, imei: String,
    warranty: String, pattern: String, mobileStatus: String,
  },

  physicalCondition: [String],
  accessories:       [String],
  visualIssues:      [String],
// code
  idProofType:  String,
  idProofImage: { url: String, public_id: String },
service: {
    engineer: String, dealer: String, drawer: String,
     
    serviceCharge:{ type: Number, default: 0 }, spareCharge: { type: Number, default: 0 },
     
    
    spareBaseline: { type: Number, default: 0 },   // ✅ FIX — was missing, silently dropped by strict mode
    rawSpareBaseline: { type: Number, default: 0 }, // ✅ NEW — same pattern as spareBaseline, but for
                                                     // rawSpareItems. Without this, Raw Spare (Shop) had
                                                     // NO cycle split at all: it always showed the FULL
                                                     // lifetime total, even right after a rebill, because
                                                     // nothing was ever subtracted from it.
     othersBaseline: { type: Number, default: 0 },  // ✅ NEW — same pattern as spareBaseline, for Others cycle-split
     advanceBaseline: { type: Number, default: 0 },   // ✅ NEW — missing, advance rebill baseline drop aagum
     income: { type: Number, default: 0 }, 
     incomeDate: { type: Date, default: null },   // ✅ FIX — missing field caused strict-mode drop
     balance: { type: Number, default: 0 },        // ✅ NEW — balance field ah save pannuchu
     balanceDate: { type: Date, default: null },   // ✅ NEW
     paymentMode: { type: String, default: "" },   // ✅ NEW — dropdown select aagi um save aagala munnaadi
     othersAmount: { type: Number, default: 0 },

    // ✅ NEW — date-wise revenue ledger
    revenueEntries: {
      type: [{
        date:    { type: Date, default: Date.now },
        service: { type: Number, default: 0 },
        spare:   { type: Number, default: 0 },
        income:  { type: Number, default: 0 },
        others:  { type: Number, default: 0 },
      }],
      default: []
    },

    repairDate: Date, deliveryDate: Date,
    remarks: String,
    advanceAmount: { type: Number, default: 0 },
   advanceItems: { type: [AdvanceItemSchema], default: [] },
othersItems: { type: [OthersItemSchema], default: [] },
advanceDate: { type: Date },
    margin:        { type: Number, default: 0 },
    serviceRep:    { type: String, default: "" },   

instaFollowers: { type: String, default: "" },   
googleReview:   { type: String, default: "" },   
  },
  spareItems: [SpareItemSchema],
  rawSpareItems: [SpareItemSchema],
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