const mongoose = require("mongoose");

const SpareItemSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  rate: Number,
  amount: Number
});

const JobSheetSchema = new mongoose.Schema({
jobSheetNo: {
  type: String,
  unique: true
},

  customer: {
    name: String,
    contact: String,
    altContact: String,
    address: String,
    email: String,
  },

   device: {
    make: String,
    model: String,
    imei: String,
    warranty: String,
    pattern: String,
    mobileStatus: String,
  },

  physicalCondition: [String],
  accessories: [String],
  visualIssues: [String],

   idProofType: String,
  idProofImage: String,

  service: {
    engineer: String,
    dealer: String,
    drawer: String,
    serviceCharge: Number,
    spareCharge: Number,
    estimate: String,
    paymentMode: String,
    repairDate: Date,
    deliveryDate: Date,
    remarks: String,
  },

    spareItems: [SpareItemSchema],


  // status: {
  //   type: String,
  //   default: "Pending",
  // },

  createdBy: {
  username: String,
  role: String
},

   isInvoiced: {
  type: Boolean,
  default: false
}
}, { timestamps: true });

module.exports = mongoose.model("JobSheet", JobSheetSchema);