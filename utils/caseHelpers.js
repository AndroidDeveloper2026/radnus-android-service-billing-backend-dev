const FeedbackCase = require("../models/FeedbackCase");
const User = require("../models/User");

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Job oda service rep → linked user
async function resolveAssignee(job, creatorUserId) {
  const repName = (job.service?.serviceRep || "").trim();
  if (!repName) return { assignee: null, note: "No service rep assigned on this job" };

  const u = await User.findOne({ role: "user", linkedRep: new RegExp(`^${esc(repName)}$`, "i") })
    .select("name username");
  if (!u) return { assignee: null, note: `Service rep "${repName}" has no linked login` };
  if (String(u._id) === String(creatorUserId)) {
    return { assignee: null, note:"Feedback employee is the service rep — routed to admin" };
  }
  return { assignee: { userId: String(u._id), name: u.name || u.username, username: u.username }, note: "" };
}

async function nextCaseNo() {
  const last = await FeedbackCase.findOne().sort({ caseNo: -1 }).select("caseNo").lean();
  return (last?.caseNo || 0) + 1;
}

// creator = { userId, name, username, role }
async function createDisputeCase({ job, feedbackId, creator, remark }) {
  const by = { userId: creator.userId, name: creator.name, role: creator.role };

  // Same job ku already open case irundha, pudhu case venaam, remark mattum add
  const existing = await FeedbackCase.findOne({
    jobSheet: job._id, type: "delivery_dispute", status: { $in: ["open", "seen", "resolved"] },
  });
  if (existing) {
    existing.messages.push({ kind: "remark", by, text: remark || "Customer raised the dispute again" });
    await existing.save();
    return existing;
  }

  const { assignee, note } = await resolveAssignee(job, creator.userId);
  return FeedbackCase.create({
    caseNo: await nextCaseNo(),
    type: "delivery_dispute",
    jobSheet: job._id,
    jobSheetNo: job.jobSheetNo,
    feedback: feedbackId,
    customerName: job.customer?.name || "",
    contact: job.customer?.contact || "",
    serviceRep: job.service?.serviceRep || "",
    createdBy: { userId: creator.userId, name: creator.name, username: creator.username },
    assignedTo: assignee,
    routedTo: assignee ? "rep" : "admin",
    routeNote: note,
    status: "open",
    messages: [{ kind: "remark", by, text: remark || "Customer says device not received" }],
  });
}

module.exports = { createDisputeCase };