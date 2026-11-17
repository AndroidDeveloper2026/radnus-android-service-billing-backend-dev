const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const JobSheet = require("../models/JobSheet");
const Feedback = require("../models/Feedback");
const FeedbackQuestion = require("../models/FeedbackQuestion");
const { CFG, DAY, normalizePhone, phoneRegex, getScenario } = require("../utils/feedbackHelpers");
const { feedbackAccess, adminOnly } = require("../middleware/roleMiddleware");
const { createDisputeCase } = require("../utils/caseHelpers");
const FeedbackExclude = require("../models/FeedbackExclude");
const FeedbackCase = require("../models/FeedbackCase");

// Indha questions DB-la irundhaalum form-la varaadhu
const REMOVED_QUESTIONS = [
  { scenario: "delivered", key: "warranty" },
];
// Ellaa feedback routes ku login + feedback access (admin ku automatic)
router.use(protect, feedbackAccess);

const TAB_OF = {
  delivered: "delivered", delivered_nrna: "delivered",
  repaired: "repaired", pending: "pending", cancelled: "cancelled",
};
const ATTEMPT_STATUSES = ["not_answered", "busy", "switched_off", "wrong_number", "callback"];

const actorOf = (req) => ({
  userId: String(req.user.userId),
  name: req.dbUser?.name || req.dbUser?.username || "admin",
  username: req.dbUser?.username || "admin",
});

// ✅ NEW — "Done" tab filter (shared by /queue count and /done list)
const doneFilter = (req) => {
  const base = { state: { $in: ["done", "internal", "skipped", "unreachable"] } };
  if (req.user.role === "admin") return base;
  const me = actorOf(req);
  return {
    $and: [
      base,
      { $or: [{ "collectedBy.userId": me.userId }, { "callAttempts.by": me.name }] },
    ],
  };
};

const baseFields = (job, scenario) => ({
  jobSheet: job._id,
  jobSheetNo: job.jobSheetNo,
  scenario,
  statusAtCall: job.device?.mobileStatus || "",
  customerName: job.customer?.name || "",
  contact: job.customer?.contact || "",
  phone: normalizePhone(job.customer?.contact),
  isDealer: !!job.service?.dealer,
  engineer: job.service?.engineer || "",
  serviceRep: job.service?.serviceRep || "",
  dealer: job.service?.dealer || "",
});

const same = (a, b) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/* ============ QUEUE ============ */
// GET /api/feedback/queue?tab=delivered|repaired|pending|cancelled|callback
router.get("/queue", async (req, res) => {
  try {
    const tab = req.query.tab || "delivered";
    const now = Date.now();

    // Job sheet date window: older than MIN_AGE_DAYS (+ optional max limit + optional from/to filter)
    const createdAt = { $lte: new Date(now - CFG.MIN_AGE_DAYS * DAY) };
    if (CFG.MAX_AGE_DAYS > 0) createdAt.$gte = new Date(now - CFG.MAX_AGE_DAYS * DAY);

    if (req.query.from) {
      const f = new Date(req.query.from + "T00:00:00");
      if (!isNaN(f) && (!createdAt.$gte || f > createdAt.$gte)) createdAt.$gte = f;
    }
    if (req.query.to) {
      const t = new Date(req.query.to + "T23:59:59.999");
      if (!isNaN(t) && t < createdAt.$lte) createdAt.$lte = t;
    }

    const jobs = await JobSheet.find({ createdAt })
      .select("jobSheetNo customer.name customer.contact device.make device.model device.mobileStatus service.engineer service.serviceRep service.dealer service.deliveryDate isCancelled createdAt visualIssues")
      .lean();

    const ids = jobs.map((j) => j._id);
    const [fbs, cooled, dnd, excl] = await Promise.all([
      Feedback.find({ jobSheet: { $in: ids } })
        .select("jobSheet scenario state nextCallAt callAttempts").lean(),
      Feedback.aggregate([
        { $match: { state: "done", collectedAt: { $gte: new Date(now - CFG.COOLDOWN_DAYS * DAY) } } },
        { $group: { _id: "$phone", last: { $max: "$collectedAt" } } },
      ]),
      Feedback.distinct("phone", { doNotCall: true }),
      FeedbackExclude.find().select("phone").lean(),
    ]);

    const fbMap = new Map(fbs.map((f) => [`${f.jobSheet}_${f.scenario}`, f]));
    const cooledMap = new Map(cooled.map((x) => [x._id, new Date(x.last).getTime()]));
    const dndSet = new Set(dnd);
    const exclSet = new Set(excl.map((x) => x.phone));

    const counts = { delivered: 0, repaired: 0, pending: 0, cancelled: 0, callback: 0 };
    const groups = {};

    for (const j of jobs) {
      const scenario = getScenario(j);
      const phone = normalizePhone(j.customer?.contact);

      const dDate = j.service?.deliveryDate ? new Date(j.service.deliveryDate).getTime() : null;
      if (scenario.startsWith("delivered") && dDate && dDate > now - CFG.DELIVERY_GAP_DAYS * DAY) continue;

      const fb = fbMap.get(`${j._id}_${scenario}`);
      if (fb && ["done", "unreachable", "skipped", "internal"].includes(fb.state)) continue;
      if (phone && (dndSet.has(phone) || exclSet.has(phone))) continue;

      let tabKey = TAB_OF[scenario];
      if (fb?.nextCallAt) {
        if (new Date(fb.nextCallAt).getTime() > now) continue;
        tabKey = "callback";
      } else if (phone && cooledMap.has(phone)) {
        const calledAt = cooledMap.get(phone);
        const wasEligible = new Date(j.createdAt).getTime() <= calledAt - CFG.MIN_AGE_DAYS * DAY;
        if (!wasEligible) continue;
      }

      counts[tabKey]++;
      if (tabKey !== tab) continue;

      const key = phone || `np_${j._id}`;
      const daysOld = Math.floor((now - new Date(j.createdAt).getTime()) / DAY);
      if (!groups[key]) {
        groups[key] = {
          key, phone,
          customerName: j.customer?.name || "-",
          contact: j.customer?.contact || "",
          isDealer: !!j.service?.dealer,
            lastCalledAt: phone && cooledMap.has(phone) ? new Date(cooledMap.get(phone)) : null,
          jobs: [], oldestDays: 0,
        };
      }
      groups[key].jobs.push({
        _id: j._id, jobSheetNo: j.jobSheetNo, scenario,
        status: j.device?.mobileStatus || "",
        make: j.device?.make || "", model: j.device?.model || "",
        daysOld,
        receivedAt: j.createdAt,
        issues: j.visualIssues || [],
        engineer: j.service?.engineer || "", serviceRep: j.service?.serviceRep || "",
        deliveryDate: j.service?.deliveryDate || null,
        attempts: fb?.callAttempts?.length || 0,
        nextCallAt: fb?.nextCallAt || null,
      });
      groups[key].oldestDays = Math.max(groups[key].oldestDays, daysOld);
    }

    counts.done = await Feedback.countDocuments(doneFilter(req));   // ✅ NEW — Done tab count

    res.json({
      tab, counts,
      config: { minAgeDays: CFG.MIN_AGE_DAYS, maxAgeDays: CFG.MAX_AGE_DAYS },
      groups: Object.values(groups).sort((a, b) => b.oldestDays - a.oldestDays),
    });
  } catch (err) {
    console.error("FEEDBACK QUEUE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ============ QUESTIONS ============ */
router.get("/questions", async (req, res) => {
  try {
        const qs = await FeedbackQuestion.find({ active: true, $nor: REMOVED_QUESTIONS })
      .sort({ scenario: 1, order: 1 }).lean();
    res.json(qs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ CUSTOMER HISTORY ============ */
// GET /api/feedback/history?phone=9876543210
router.get("/history", async (req, res) => {
  try {
    const digits = normalizePhone(req.query.phone);
    const rx = phoneRegex(digits);
    if (!rx) return res.json({ phone: digits, names: [], visitCount: 0, jobs: [], feedbacks: [] });

    const jobs = await JobSheet.find({ $or: [{ "customer.contact": rx }, { "customer.altContact": rx }] })
      .select("jobSheetNo customer.name device.make device.model device.mobileStatus visualIssues service.engineer service.serviceRep service.deliveryDate isCancelled createdAt")
      .sort({ createdAt: -1 }).lean();

    // Repeat issue: same device + same issue, 90 naal kulla
    const asc = [...jobs].reverse();
    asc.forEach((j, i) => {
      j.repeatOf = null;
      for (let k = 0; k < i; k++) {
        const p = asc[k];
        const sameDevice = j.device?.make && p.device?.make === j.device.make && p.device?.model === j.device?.model;
        const gap = (new Date(j.createdAt) - new Date(p.createdAt)) / DAY;
        const overlap = (j.visualIssues || []).some((x) => (p.visualIssues || []).includes(x));
        if (sameDevice && overlap && gap <= 90) j.repeatOf = p.jobSheetNo;
      }
    });

    const feedbacks = await Feedback.find({ phone: digits, state: "done" })
            .select("jobSheetNo scenario rating flags comments collectedBy collectedAt answers")
      .sort({ collectedAt: -1 }).lean();

    const attempted = await Feedback.find({
      phone: digits,
      state: { $in: ["open", "unreachable"] },
      "callAttempts.0": { $exists: true },
    }).select("jobSheetNo state callAttempts nextCallAt").lean();

    res.json({
      phone: digits,
      names: [...new Set(jobs.map((j) => j.customer?.name).filter(Boolean))],
      visitCount: jobs.length,
      firstVisit: jobs.length ? jobs[jobs.length - 1].createdAt : null,
      lastVisit: jobs.length ? jobs[0].createdAt : null,
      hasDispute: feedbacks.some((f) => f.flags?.includes("delivery_dispute")),
            jobs, feedbacks, attempted,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ CALL ATTEMPT (answer aagala) ============ */
// POST body: { jobSheetIds:[], status, note, nextCallAt, doNotCall }
router.post("/attempt", async (req, res) => {
  try {
    const { jobSheetIds = [], status, note = "", nextCallAt, doNotCall = false } = req.body;
    if (!jobSheetIds.length || !ATTEMPT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid attempt" });
    }
    if (status === "callback" && !nextCallAt) {
      return res.status(400).json({ message: "Call back date/time required" });
    }
    const actor = actorOf(req);

    for (const id of jobSheetIds) {
      const job = await JobSheet.findById(id);
      if (!job) continue;
      const scenario = getScenario(job);

      let fb = await Feedback.findOne({ jobSheet: job._id, scenario });
      if (!fb) fb = new Feedback(baseFields(job, scenario));
      if (fb.state === "done") continue;

      fb.callAttempts.push({ status, by: actor.name, note });

      if (doNotCall) fb.doNotCall = true;
      if (status === "wrong_number" || doNotCall || fb.callAttempts.length >= CFG.MAX_ATTEMPTS) {
        fb.state = "unreachable";
        fb.nextCallAt = null;
      } else {
        fb.state = "open";
        fb.nextCallAt = nextCallAt ? new Date(nextCallAt) : new Date(Date.now() + DAY);
      }
      await fb.save();
    }
    res.json({ message: "Attempt saved ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ SUBMIT FEEDBACK (call answer aachu) ============ */
// POST body: { jobSheetId, spokeWith, answers:[{key,answer}], comments, doNotCall }
router.post("/", async (req, res) => {
  try {
    const { jobSheetId, spokeWith = "customer", answers = [], comments = "", doNotCall = false,
      notifyRep = false, repRemark = "" } = req.body;

    const job = await JobSheet.findById(jobSheetId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const scenario = getScenario(job);
        const questions = await FeedbackQuestion.find({ scenario, active: true, $nor: REMOVED_QUESTIONS })
      .sort({ order: 1 }).lean();

    const ans = {};
    answers.forEach((a) => { ans[a.key] = a.answer; });
    const visible = (q) => !q.showIf?.key || same(ans[q.showIf.key], q.showIf.value);

    const missing = questions.filter(
      (q) => q.required && visible(q) && (ans[q.key] === undefined || ans[q.key] === "")
    );
    if (missing.length) {
      return res.status(400).json({ message: "Required: " + missing.map((q) => q.text).join(" | ") });
    }

    const snap = [];
    const flags = new Set();
    let rating = null;

    for (const q of questions) {
      if (!visible(q) || ans[q.key] === undefined || ans[q.key] === "") continue;
      snap.push({ key: q.key, questionText: q.text, type: q.type, answer: ans[q.key] });
      if (q.key === "overall") rating = Number(ans[q.key]);
      if (q.flagKey && q.flagIf) {
        const hit = q.flagIf.op === "lte"
          ? Number(ans[q.key]) <= Number(q.flagIf.value)
          : same(ans[q.key], q.flagIf.value);
        if (hit) flags.add(q.flagKey);
      }
    }

    let fb = await Feedback.findOne({ jobSheet: job._id, scenario });
    if (fb?.state === "done") return res.status(409).json({ message: "Feedback already collected" });
    if (!fb) fb = new Feedback(baseFields(job, scenario));

    fb.spokeWith = spokeWith;
    fb.answers = snap;
    fb.rating = rating;
    fb.comments = comments;
    fb.flags = [...flags];
    fb.followUp = { required: flags.size > 0, note: "" };
    fb.state = "done";
    fb.nextCallAt = null;
    fb.doNotCall = !!doNotCall || fb.doNotCall;
    fb.collectedBy = actorOf(req);
    fb.collectedAt = new Date();
    await fb.save();

    // Delivery dispute + "Rep ku notify" select pannirundha → Case create
    let caseInfo = null;
    if (flags.has("delivery_dispute") && notifyRep) {
      const a = actorOf(req);
      const c = await createDisputeCase({
        job,
        feedbackId: fb._id,
        creator: { ...a, role: req.user.role === "admin" ? "admin" : "feedback" },
        remark: repRemark,
      });
      caseInfo = {
        caseNo: c.caseNo,
        routedTo: c.routedTo,
        assignedTo: c.assignedTo?.name || "",
        routeNote: c.routeNote || "",
      };
    }

    res.json({ message: "Feedback saved ✅", flags: [...flags], case: caseInfo });
  } catch (err) {
    console.error("FEEDBACK SAVE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ============ ADMIN SUMMARY (Feedback Report page) ============ */
// GET /api/feedback/summary?from=2026-11-01&to=2026-11-16
router.get("/summary", adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from
      ? new Date(req.query.from + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to + "T23:59:59.999") : now;

    // Previous period of the same length (for ▲▼ comparison)
    const span = Math.max(to - from, DAY);
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - span);

    const avg = (s, n) => (n ? +(s / n).toFixed(2) : null);
    const pct = (a, b) => (b ? +((a / b) * 100).toFixed(1) : null);
    const ymd = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const [done, attempted, prevDone, prevAttempted, questionMeta, unreachable, openAttempts, caseList, caseCreated, closedByStaff] =
      await Promise.all([
        Feedback.find({ state: "done", collectedAt: { $gte: from, $lte: to } })
          .select("scenario rating flags collectedBy collectedAt engineer serviceRep answers").lean(),
        Feedback.find({ "callAttempts.at": { $gte: from, $lte: to } })
          .select("callAttempts").lean(),
        Feedback.find({ state: "done", collectedAt: { $gte: prevFrom, $lte: prevTo } })
          .select("rating flags").lean(),
        Feedback.find({ "callAttempts.at": { $gte: prevFrom, $lte: prevTo } })
          .select("callAttempts").lean(),
        FeedbackQuestion.find().select("scenario key order").lean(),
        Feedback.countDocuments({ state: "unreachable", updatedAt: { $gte: from, $lte: to } }),
        Feedback.countDocuments({ state: "open", "callAttempts.0": { $exists: true } }),
        FeedbackCase.find({ status: { $ne: "closed" } }).select("status escalated").lean(),
        FeedbackCase.countDocuments({ createdAt: { $gte: from, $lte: to } }),
        // jobs an employee closed WITHOUT collecting feedback (skip / internal / unreachable)
        Feedback.find({
          state: { $in: ["skipped", "internal", "unreachable"] },
          "collectedBy.name": { $exists: true, $ne: "" },
          updatedAt: { $gte: from, $lte: to },
        }).select("state collectedBy updatedAt").lean(),
      ]);

    const qOrder = new Map(questionMeta.map((q) => [`${q.scenario}:${q.key}`, q.order ?? 0]));
    const removed = new Set(REMOVED_QUESTIONS.map((q) => `${q.scenario}:${q.key}`));

    // ---- daily skeleton (every day in range, even with 0 calls)
    const daily = {};
    for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d.setDate(d.getDate() + 1)) {
      daily[ymd(d)] = { date: ymd(d), collected: 0, attempts: 0 };
    }

    const emp = {};
    const getEmp = (n) =>
      (emp[n] ||= {
        name: n, collected: 0, ratingSum: 0, ratingN: 0, flagged: 0, byScenario: {}, attempts: {}, attemptTotal: 0,
        skipped: 0, internal: 0, closedUnreach: 0, days: {}, firstAt: 0, lastAt: 0,
      });

    // day-wise activity + first / last activity time per employee
    const touch = (e, at, kind) => {
      const t = new Date(at);
      if (isNaN(t)) return;
      const k = ymd(t);
      (e.days[k] ||= { c: 0, a: 0 })[kind]++;
      const ms = t.getTime();
      if (!e.firstAt || ms < e.firstAt) e.firstAt = ms;
      if (ms > e.lastAt) e.lastAt = ms;
    };

    const byScenario = {};
    const flags = {};
    const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byEngineer = {};
    const byRep = {};
    const qStats = {};
    let ratingSum = 0, ratingN = 0, flagged = 0;

    const bump = (map, name, f) => {
      const k = (name || "").trim() || "Unassigned";
      const o = (map[k] ||= { name: k, collected: 0, ratingSum: 0, ratingN: 0, flagged: 0, low: 0 });
      o.collected++;
      if (f.rating) { o.ratingSum += f.rating; o.ratingN++; if (f.rating <= 2) o.low++; }
      if (f.flags?.length) o.flagged++;
    };

    for (const f of done) {
      const e = getEmp(f.collectedBy?.name || "unknown");
      e.collected++;
      touch(e, f.collectedAt, "c");
      e.byScenario[f.scenario] = (e.byScenario[f.scenario] || 0) + 1;

      const s = (byScenario[f.scenario] ||= { collected: 0, ratingSum: 0, ratingN: 0, flagged: 0 });
      s.collected++;
      if (f.flags?.length) { s.flagged++; e.flagged++; flagged++; }

      if (f.rating) {
        e.ratingSum += f.rating; e.ratingN++;
        s.ratingSum += f.rating; s.ratingN++;
        ratingSum += f.rating; ratingN++;
        const r = Math.round(f.rating);
        if (ratingDist[r] !== undefined) ratingDist[r]++;
      }
      (f.flags || []).forEach((k) => { flags[k] = (flags[k] || 0) + 1; });

      bump(byEngineer, f.engineer, f);
      bump(byRep, f.serviceRep, f);

      const day = f.collectedAt ? daily[ymd(new Date(f.collectedAt))] : null;
      if (day) day.collected++;

      // question-wise answers
      for (const a of f.answers || []) {
        const id = `${f.scenario}:${a.key}`;
        if (removed.has(id) || a.answer === undefined || a.answer === "") continue;
        const q = (qStats[id] ||= {
          scenario: f.scenario, key: a.key, text: a.questionText || a.key, type: a.type,
          order: qOrder.get(id) ?? 999, n: 0, yes: 0, no: 0, sum: 0, options: {},
        });
        q.n++;
        if (a.type === "yesno") {
          if (String(a.answer).toLowerCase() === "yes") q.yes++; else q.no++;
        } else if (a.type === "rating") {
          q.sum += Number(a.answer) || 0;
        } else if (a.type === "choice") {
          q.options[a.answer] = (q.options[a.answer] || 0) + 1;
        }
      }
    }

    let attemptTotal = 0;
    for (const f of attempted) {
      for (const a of f.callAttempts || []) {
        const t = new Date(a.at);
        if (t < from || t > to) continue;
        const e = getEmp(a.by || "unknown");
        e.attempts[a.status] = (e.attempts[a.status] || 0) + 1;
        e.attemptTotal++;
        touch(e, t, "a");
        attemptTotal++;
        const day = daily[ymd(t)];
        if (day) day.attempts++;
      }
    }

    // ---- closed without feedback (skip / internal / unreachable) per employee
    for (const f of closedByStaff) {
      const e = getEmp(f.collectedBy.name);
      if (f.state === "skipped") e.skipped++;
      else if (f.state === "internal") e.internal++;
      else e.closedUnreach++;
    }

    // ---- previous period totals
    let pRatingSum = 0, pRatingN = 0, pFlagged = 0, pAttempts = 0;
    for (const f of prevDone) {
      if (f.rating) { pRatingSum += f.rating; pRatingN++; }
      if (f.flags?.length) pFlagged++;
    }
    for (const f of prevAttempted) {
      for (const a of f.callAttempts || []) {
        const t = new Date(a.at);
        if (t >= prevFrom && t <= prevTo) pAttempts++;
      }
    }

    const finishNamed = (map) =>
      Object.values(map)
        .map((o) => ({ name: o.name, collected: o.collected, avgRating: avg(o.ratingSum, o.ratingN), flagged: o.flagged, low: o.low }))
        .sort((a, b) => b.collected - a.collected);

    const questions = {};
    Object.values(qStats)
      .sort((a, b) => a.order - b.order)
      .forEach((q) => {
        (questions[q.scenario] ||= []).push({
          key: q.key, text: q.text, type: q.type, n: q.n,
          yes: q.yes, no: q.no,
          avg: q.type === "rating" ? avg(q.sum, q.n) : null,
          options: q.options,
        });
      });

    const calls = done.length + attemptTotal;
    const prevCalls = prevDone.length + pAttempts;

    res.json({
      range: { from, to },
      prevRange: { from: prevFrom, to: prevTo },
      totals: {
        collected: done.length,
        avgRating: avg(ratingSum, ratingN),
        flagged,
        flaggedRate: pct(flagged, done.length),
        attempts: attemptTotal,
        calls,
        contactRate: pct(done.length, calls),
        unreachable,
      },
      prev: {
        collected: prevDone.length,
        avgRating: avg(pRatingSum, pRatingN),
        flaggedRate: pct(pFlagged, prevDone.length),
        calls: prevCalls,
        contactRate: pct(prevDone.length, prevCalls),
      },
      openAttempts,
      cases: {
        created: caseCreated,
        open: caseList.filter((c) => ["open", "seen"].includes(c.status)).length,
        awaitingClose: caseList.filter((c) => c.status === "resolved").length,
        escalated: caseList.filter((c) => c.escalated).length,
      },
      ratingDist,
      daily: Object.values(daily),
      byScenario: Object.fromEntries(
        Object.entries(byScenario).map(([k, v]) => [
          k, { collected: v.collected, avgRating: avg(v.ratingSum, v.ratingN), flagged: v.flagged },
        ])
      ),
      byEmployee: Object.values(emp)
        .map((e) => ({
          name: e.name, collected: e.collected, avgRating: avg(e.ratingSum, e.ratingN), flagged: e.flagged,
          byScenario: e.byScenario, attempts: e.attempts, attemptTotal: e.attemptTotal,
          contactRate: pct(e.collected, e.collected + e.attemptTotal),
          skipped: e.skipped, internal: e.internal, closedUnreach: e.closedUnreach,
          activeDays: Object.keys(e.days).length,
          avgPerActiveDay: avg(e.collected + e.attemptTotal, Object.keys(e.days).length),
          firstActiveAt: e.firstAt || null,
          lastActiveAt: e.lastAt || null,
          daily: e.days,
        }))
        .sort((a, b) => b.collected - a.collected),
      byEngineer: finishNamed(byEngineer),
      byServiceRep: finishNamed(byRep),
      questions,
      flags,
    });
  } catch (err) {
    console.error("FEEDBACK SUMMARY ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ============ DONE / INTERNAL / SKIPPED / UNREACHABLE ============ */
router.get("/done", async (req, res) => {
  try {
    const filter = doneFilter(req);
    const list = await Feedback.find(filter)
      .sort({ updatedAt: -1 }).limit(150)
      .select("jobSheetNo customerName scenario rating flags state skipReason collectedBy updatedAt callAttempts").lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ ATTEMPTS (answer aagadha calls) ============ */
router.get("/attempts", async (req, res) => {
  try {
    const base = {
            state: "open",
      "callAttempts.0": { $exists: true },
    };
    let filter = base;
    if (req.user.role !== "admin") {
      const me = actorOf(req);
      filter = { ...base, "callAttempts.by": me.name };
    }
    const list = await Feedback.find(filter)
      .sort({ updatedAt: -1 }).limit(300)
      .select("jobSheet jobSheetNo customerName contact phone isDealer scenario state callAttempts nextCallAt updatedAt")
      .lean();

    // Call screen open panna job details venum
    const jobs = await JobSheet.find({ _id: { $in: list.map((f) => f.jobSheet) } })
      .select("jobSheetNo customer.name customer.contact device.make device.model device.mobileStatus service.engineer service.serviceRep service.deliveryDate isCancelled createdAt visualIssues")
      .lean();
    const jobMap = new Map(jobs.map((j) => [String(j._id), j]));
    const now = Date.now();

    res.json(list.map((f) => {
      const j = jobMap.get(String(f.jobSheet));
      return {
        ...f,
        job: j ? {
          _id: j._id,
          jobSheetNo: j.jobSheetNo,
          scenario: getScenario(j),
          status: j.device?.mobileStatus || "",
          make: j.device?.make || "",
          model: j.device?.model || "",
          daysOld: Math.floor((now - new Date(j.createdAt).getTime()) / DAY),
          receivedAt: j.createdAt,
          issues: j.visualIssues || [],
          engineer: j.service?.engineer || "",
          serviceRep: j.service?.serviceRep || "",
          deliveryDate: j.service?.deliveryDate || null,
          attempts: f.callAttempts?.length || 0,
          nextCallAt: f.nextCallAt || null,
        } : null,
      };
    }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ CLOSE AS UNREACHABLE (attempts mudinjadhu → Done) ============ */
router.post("/unreachable", async (req, res) => {
  try {
    const { jobSheetIds = [], note = "" } = req.body;
    if (!jobSheetIds.length) return res.status(400).json({ message: "No jobs" });
    const actor = actorOf(req);

    for (const id of jobSheetIds) {
      const job = await JobSheet.findById(id);
      if (!job) continue;
      const scenario = getScenario(job);
      const fb = await Feedback.findOne({ jobSheet: job._id, scenario });
      if (!fb || fb.state === "done" || !fb.callAttempts.length) continue;

      fb.state = "unreachable";
      fb.nextCallAt = null;
      if (note) fb.skipReason = note;
      fb.collectedBy = actor;
      await fb.save();
    }
    res.json({ message: "Closed ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ SKIP (feedback venaam) ============ */
// POST body: { jobSheetIds:[], reason }
router.post("/skip", async (req, res) => {
  try {
    const { jobSheetIds = [], reason = "" } = req.body;
    if (!jobSheetIds.length) return res.status(400).json({ message: "No jobs" });
    const actor = actorOf(req);

    for (const id of jobSheetIds) {
      const job = await JobSheet.findById(id);
      if (!job) continue;
      const scenario = getScenario(job);

      let fb = await Feedback.findOne({ jobSheet: job._id, scenario });
      if (!fb) fb = new Feedback(baseFields(job, scenario));
      if (fb.state === "done") continue;

      fb.state = "skipped";
      fb.skipReason = reason;
      fb.nextCallAt = null;
      fb.collectedBy = actor;
      await fb.save();
    }
    res.json({ message: "Skipped ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ============ MARK AS STAFF / INTERNAL ============ */
// POST body: { phone, customerName, jobSheetIds:[] }
router.post("/internal", async (req, res) => {
  try {
    const { phone = "", customerName = "", jobSheetIds = [] } = req.body;
    const digits = normalizePhone(phone);
    const actor = actorOf(req);
    const now = Date.now();

    const idSet = new Set(jobSheetIds.map(String));

    if (digits) {
      // 1) Exclude list la serkkurom (innimel queue la varaadhu)
      await FeedbackExclude.updateOne(
        { phone: digits },
        { $setOnInsert: { customerName, reason: "Internal / Staff", addedBy: actor } },
        { upsert: true }
      );

      // 2) Indha number oda window ulla matha jobs um (vera tab la irundhaalum)
      const rx = phoneRegex(digits);
      if (rx) {
        const range = { $lte: new Date(now - CFG.MIN_AGE_DAYS * DAY) };
        if (CFG.MAX_AGE_DAYS > 0) range.$gte = new Date(now - CFG.MAX_AGE_DAYS * DAY);
        const more = await JobSheet.find({
          "customer.contact": rx,
          createdAt: range,
        }).select("_id").lean();
        more.forEach((m) => idSet.add(String(m._id)));
      }
    }

    // 3) Ovvoru job um "internal" nu Done la kaattu
    for (const id of idSet) {
      const job = await JobSheet.findById(id);
      if (!job) continue;
      const scenario = getScenario(job);

      let fb = await Feedback.findOne({ jobSheet: job._id, scenario });
      if (!fb) fb = new Feedback(baseFields(job, scenario));
      if (fb.state === "done") continue;       // already feedback eduthadhu maatha vendaam

      fb.state = "internal";
      fb.skipReason = "Internal / Staff";
      fb.nextCallAt = null;
      fb.collectedBy = actor;
      await fb.save();
    }

    res.json({ message: "Marked as internal ✅" });
  } catch (err) {
    console.error("FEEDBACK INTERNAL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ============ EXCLUDE LIST (admin) ============ */
router.get("/exclude", adminOnly, async (req, res) => {
  try {
    res.json(await FeedbackExclude.find().sort({ createdAt: -1 }).lean());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove pannaa andha number thirumba queue ku varum
router.delete("/exclude/:id", adminOnly, async (req, res) => {
  try {
    const ex = await FeedbackExclude.findByIdAndDelete(req.params.id);
    if (ex) await Feedback.deleteMany({ phone: ex.phone, state: "internal" });
    res.json({ message: "Removed ✅" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;