// utils/jobNumber.js
// Per-store, race-safe job sheet numbering:  <jobPrefix>-<seq padded to 3>
const Counter = require("../models/Counter");
const JobSheet = require("../models/JobSheet");
const { escapeRegex } = require("./storeHelpers");

const format = (prefix, n) => `${prefix}-${String(n).padStart(3, "0")}`;
const counterId = (store) => `jobsheet:${store._id}`;

// Highest number already used under this prefix (only scanned when a counter doesn't exist yet).
async function maxExisting(prefix) {
  const re = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  const docs = await JobSheet.find({ jobSheetNo: { $regex: re } }).select("jobSheetNo").lean();
  return docs.reduce((max, d) => {
    const n = parseInt(d.jobSheetNo.match(re)[1], 10);
    return n > max ? n : max;
  }, 0);
}

// First use for a store: seed the counter from the highest existing number so
// numbering continues (JS-810 -> next is JS-811) instead of restarting at 1.
async function ensureCounter(store) {
  const id = counterId(store);
  if (await Counter.exists({ _id: id })) return;
  const seed = await maxExisting(store.jobPrefix);
  await Counter.updateOne({ _id: id }, { $setOnInsert: { seq: seed } }, { upsert: true });
}

async function allocateJobNo(store) {
  await ensureCounter(store);
  const c = await Counter.findOneAndUpdate(
    { _id: counterId(store) },
    { $inc: { seq: 1 } },
    { returnDocument: "after" }
  );
  return format(store.jobPrefix, c.seq);
}

// Preview only (what the Job Sheet page shows before saving). Does NOT reserve the number.
async function peekNextJobNo(store) {
  await ensureCounter(store);
  const c = await Counter.findById(counterId(store)).lean();
  return format(store.jobPrefix, (c?.seq || 0) + 1);
}

// Allocate a number, build + save the doc. If the unique index on jobSheetNo still
// complains (e.g. someone manually inserted a higher number), re-sync and retry.
async function saveWithNewNumber(store, buildJob) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const jobSheetNo = await allocateJobNo(store);
    const job = buildJob(jobSheetNo);
    try {
      await job.save();
      return job;
    } catch (err) {
      if (err.code !== 11000) throw err;
      if (attempt === 3) {
        const max = await maxExisting(store.jobPrefix);
        await Counter.updateOne({ _id: counterId(store) }, { $max: { seq: max } });
      }
    }
  }
  throw new Error("Could not allocate a unique job sheet number, please try again");
}

module.exports = { format, allocateJobNo, peekNextJobNo, saveWithNewNumber, maxExisting };