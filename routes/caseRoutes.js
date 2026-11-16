const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const User = require("../models/User");
const JobSheet = require("../models/JobSheet");
const FeedbackCase = require("../models/FeedbackCase");

const HOUR = 3600000;
// "readonly" = admin only views cases the rep / employee are handling
// "full"     = admin can message, reply and close every case (old behaviour)
const ADMIN_MODE = process.env.CASE_ADMIN_MODE || "readonly";
const OUTCOMES = ["delivery_confirmed", "customer_confusion", "status_wrong", "device_missing"];

router.use(protect);

// logged-in user ah DB la irundhu edukkurom
router.use(async (req, res, next) => {
  try {
    const me = await User.findById(req.user.userId).select("name username role linkedRep");
    if (!me) return res.status(401).json({ message: "User not found" });
    req.me = me;
    next();
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

const permOf = (c, me) => {
  const id = String(me._id);
  const isAdmin = me.role === "admin";
  const isAssignee = c.assignedTo?.userId === id;
  const isCreator = c.createdBy?.userId === id;
  const notClosed = c.status !== "closed";
  // Admin must act when nobody else can: no rep linked (routed to admin) or escalated
  const adminActs = isAdmin && (ADMIN_MODE === "full" || c.routedTo === "admin" || c.escalated);
  return {
    isAdmin, isAssignee, isCreator,
    adminReadOnly: isAdmin && !adminActs,
    canView: isAdmin || isAssignee || isCreator,
    canMessage: notClosed && (adminActs || isAssignee || isCreator),
    canResolve: ["open", "seen"].includes(c.status) && (isAssignee || adminActs),
    canClose: notClosed && (adminActs || (isCreator && c.status === "resolved")),
  };
};

const byOf = (me, perm) => ({
  userId: String(me._id),
  name: me.name || me.username,
  role: perm.isAdmin ? "admin" : perm.isAssignee ? "rep" : "feedback",
});

/* ===== BELL / BADGE COUNT ===== */
router.get("/badge", async (req, res) => {
  try {
    const now = Date.now();
    const id = String(req.me._id);
    let count = 0;

    if (req.me.role === "admin") {
      const list = await FeedbackCase.find({ status: { $ne: "closed" } })
        .select("status routedTo escalated createdAt").lean();
      count = list.filter((c) =>
        c.escalated ||
        (["open", "seen"].includes(c.status) &&
          (c.routedTo === "admin" || now - new Date(c.createdAt) > 48 * HOUR))
      ).length;
    } else {
      count = await FeedbackCase.countDocuments({
        $or: [
          { "assignedTo.userId": id, status: { $in: ["open", "seen"] } },   // rep: reply pannanum
          { "createdBy.userId": id, status: "resolved" },                    // employee: close pannanum
        ],
      });
    }
    res.json({ count });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ===== LIST ===== */
// GET /api/cases?scope=active|closed
router.get("/", async (req, res) => {
  try {
    const id = String(req.me._id);
    const filter = req.query.scope === "closed" ? { status: "closed" } : { status: { $ne: "closed" } };
    if (req.me.role !== "admin") {
      filter.$or = [{ "assignedTo.userId": id }, { "createdBy.userId": id }];
    }
    const list = await FeedbackCase.find(filter).sort({ updatedAt: -1 }).limit(200).select("-messages").lean();

    const now = Date.now();
    res.json(list.map((c) => {
      const age = now - new Date(c.createdAt);
      const waiting = ["open", "seen"].includes(c.status);
      return {
        ...c,
        ageHours: Math.floor(age / HOUR),
        sla: waiting ? (c.escalated || age > 48 * HOUR ? "escalated" : age > 24 * HOUR ? "reminder" : "ok") : "ok",
      };
    }));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ===== DETAIL (rep open pannaa "seen" aagum) ===== */
router.get("/:id", async (req, res) => {
  try {
    const c = await FeedbackCase.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Case not found" });

    let perm = permOf(c, req.me);
    if (!perm.canView) return res.status(403).json({ message: "Not allowed" });

    if (perm.isAssignee && c.status === "open") {
      c.status = "seen";
      c.seenAt = new Date();
      c.messages.push({ kind: "system", by: byOf(req.me, perm), text: `Seen by ${req.me.name || req.me.username}` });
      await c.save();
      perm = permOf(c, req.me);
    }

    const job = await JobSheet.findById(c.jobSheet)
      .select("jobSheetNo customer.name customer.contact device.make device.model device.mobileStatus service.engineer service.serviceRep service.deliveryDate createdAt createdBy statusLogs")
      .lean();
    if (job) job.statusLogs = (job.statusLogs || []).slice(-6);

    res.json({ case: c, job, perm });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ===== MESSAGE ===== */
router.post("/:id/message", async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ message: "Please enter a message" });
    const c = await FeedbackCase.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const perm = permOf(c, req.me);
    if (!perm.canMessage) return res.status(403).json({ message: "Not allowed" });

    c.messages.push({ kind: "note", by: byOf(req.me, perm), text });
    await c.save();
    res.json({ message: "Sent ✅" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ===== REP REPLY (RESOLVE) ===== */
router.post("/:id/resolve", async (req, res) => {
  try {
    const { outcome, text = "" } = req.body;
    if (!OUTCOMES.includes(outcome)) return res.status(400).json({ message: "Please select an outcome" });

    const c = await FeedbackCase.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const perm = permOf(c, req.me);
    if (!perm.canResolve) return res.status(403).json({ message: "Not allowed" });

    const by = byOf(req.me, perm);
    c.status = "resolved";
    c.outcome = outcome;
    c.resolvedAt = new Date();
    c.messages.push({ kind: "reply", by, outcome, text });

    if (outcome === "device_missing") {
      c.escalated = true;
      c.messages.push({ kind: "system", by, text: "⚠️ Device missing — escalated to admin" });
    }
    await c.save();
    res.json({ message: "Reply sent ✅" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/* ===== CLOSE ===== */
router.post("/:id/close", async (req, res) => {
  try {
    const c = await FeedbackCase.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Case not found" });
    const perm = permOf(c, req.me);
    if (!perm.canClose) {
      return res.status(403).json({ message: "A case can be closed only after the rep has replied" });
    }
    c.status = "closed";
    c.closedAt = new Date();
    c.messages.push({ kind: "note", by: byOf(req.me, perm), text: (req.body.text || "").trim() || "Customer informed. Closed." });
    await c.save();
    res.json({ message: "Closed ✅" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;