const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

require("dotenv").config();
const mongoose = require("mongoose");
const FeedbackQuestion = require("./models/FeedbackQuestion");

const Y = { key: "received", value: "Yes" };
const N = { key: "received", value: "No" };
const yes = (v) => ({ op: "eq", value: v });

// [key, text, type, extra]
const S = {
  delivered: [
    ["received", "Did you receive your device?", "yesno",
      { required: true, flagKey: "delivery_dispute", flagIf: yes("No") }],
    // ---- dispute branch (received = No)
    ["dispute_who",  "Who collected it, if anyone? (name / relation)", "text", { showIf: N }],
    ["dispute_when", "When / where was it delivered, as per the customer?", "text", { showIf: N }],
    ["dispute_know", "Does the customer know where the device is now?", "choice",
      { options: ["Yes", "No", "Not sure"], showIf: N }],
    // ---- normal branch (received = Yes)
    ["fixed",   "Is the problem fixed?", "yesno", { showIf: Y, flagKey: "issue_not_fixed", flagIf: yes("No") }],
    ["repeat",  "Did the same problem come back?", "yesno", { showIf: Y, flagKey: "repeat_issue", flagIf: yes("Yes") }],
    ["ontime",  "Was it ready within the promised time?", "yesno", { showIf: Y }],
    ["bill",    "Were the bill / charges clear?", "yesno", { showIf: Y, flagKey: "billing_complaint", flagIf: yes("No") }],
    ["staff",   "Staff behaviour (1-5)", "rating", { showIf: Y }],
    ["overall", "Overall rating (1-5)", "rating", { showIf: Y, required: true, flagKey: "low_rating", flagIf: { op: "lte", value: 2 } }],
    ["google",  "Google review", "choice", { options: ["Already done", "Agreed", "Declined", "Not asked"], showIf: Y }],
  ],
  delivered_nrna: [
    ["received", "Did you get your device back?", "yesno",
      { required: true, flagKey: "delivery_dispute", flagIf: yes("No") }],
    ["informed", "Were you told clearly why it was not repaired?", "yesno", { showIf: Y, flagKey: "not_informed", flagIf: yes("No") }],
    ["reason_ok","Are you satisfied with the explanation?", "yesno", { showIf: Y }],
    ["charges",  "Was any checking charge taken?", "choice",
      { options: ["No", "Yes - explained", "Yes - not explained"], showIf: Y, flagKey: "charge_complaint", flagIf: yes("Yes - not explained") }],
    ["accessories", "Did you get all accessories back?", "yesno", { showIf: Y, flagKey: "accessories_missing", flagIf: yes("No") }],
    ["overall",  "Overall rating (1-5)", "rating", { showIf: Y, required: true, flagKey: "low_rating", flagIf: { op: "lte", value: 2 } }],
  ],
  repaired: [
    ["informed", "Did you get a call / message that the device is ready?", "yesno",
      { required: true, flagKey: "not_informed", flagIf: yes("No") }],
    ["pickup",   "When will you collect it?", "choice", { options: ["Today", "This week", "Later", "Not interested"] }],
    ["blocker",  "Any problem in collecting?", "choice", { options: ["None", "Payment", "Distance / time", "Doubt about repair", "Other"] }],
    ["home_delivery", "Need home delivery?", "yesno", { flagKey: "home_delivery_request", flagIf: yes("Yes") }],
    ["overall",  "Rate how we handled your repair so far (1-5)", "rating", { required: true, flagKey: "low_rating", flagIf: { op: "lte", value: 2 } }],
  ],
  pending: [
    ["aware",    "Do you know the current status of your device?", "yesno", { required: true, flagKey: "not_informed", flagIf: yes("No") }],
    ["delay_told","Were you told the reason for the delay?", "yesno", { flagKey: "delay_not_explained", flagIf: yes("No") }],
    ["acceptable","Is the expected time OK for you?", "yesno" ],
    ["continue", "Do you want to continue the repair?", "choice",
      { options: ["Continue", "Cancel", "Need callback"], flagKey: "wants_cancel", flagIf: yes("Cancel") }],
    ["overall",  "Rate our updates / communication (1-5)", "rating", { required: true, flagKey: "low_rating", flagIf: { op: "lte", value: 2 } }],
  ],
  cancelled: [
    ["reason",   "Why was it cancelled?", "choice", { options: ["Price", "Delay", "Not repairable", "Went elsewhere", "Other"] }],
    ["received", "Did you get your device back?", "yesno", { required: true, flagKey: "delivery_dispute", flagIf: yes("No") }],
    ["charged",  "Was any charge taken?", "choice",
      { options: ["No", "Yes - explained", "Yes - not explained"], flagKey: "charge_complaint", flagIf: yes("Yes - not explained") }],
    ["return",   "Would you come back to us?", "yesno"],
    ["overall",  "Overall rating (1-5)", "rating", { required: true, flagKey: "low_rating", flagIf: { op: "lte", value: 2 } }],
  ],
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  let n = 0;
  for (const [scenario, rows] of Object.entries(S)) {
    for (const [i, [key, text, type, extra = {}]] of rows.entries()) {
      const r = await FeedbackQuestion.updateOne(
        { scenario, key },
        { $setOnInsert: { text, type, order: (i + 1) * 10, active: true, required: false, options: [], ...extra } },
        { upsert: true }
      );
      if (r.upsertedCount) n++;
    }
  }
  console.log(`✅ Seeded ${n} new questions`);
  process.exit(0);
})();