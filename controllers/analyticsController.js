// controllers/analyticsController.js
// Admin analytics: bookings / delivery / revenue (service-rep wise + engineer wise) + feedback.
// Read-only. Nothing in the existing collections is changed.

const JobSheet     = require("../models/JobSheet");
const Feedback     = require("../models/Feedback");
const FeedbackCase = require("../models/FeedbackCase");

const DAY       = 24 * 60 * 60 * 1000;
const TZ        = "Asia/Kolkata";
const DELIVERED = ["Delivered", "Delivered NR/NA"];
const DONE      = ["Delivered", "Delivered NR/NA", "Repaired"];

/* ---------- small helpers ---------- */

// trimmed name, "Unassigned" when empty  (so "Ajith" / "ajith " land in one bucket)
const nameExpr = (path) => ({
  $let: {
    vars: { n: { $trim: { input: { $toString: { $ifNull: [path, ""] } } } } },
    in:   { $cond: [{ $eq: ["$$n", ""] }, "Unassigned", "$$n"] },
  },
});
const keyExpr = (path) => ({ $toLower: nameExpr(path) });

const rng = (a, b) => ({ $gte: a, $lte: b });

// service.deliveryDate is entered by the user — fall back to updatedAt when it is empty
const deliveredAt = { $ifNull: ["$service.deliveryDate", "$updatedAt"] };
const repairedAt  = { $ifNull: ["$service.repairDate",   "$updatedAt"] };

const createdMatch   = (R) => ({ createdAt: R });
const cancelledMatch = (R) => ({ isCancelled: true, cancelledAt: R });
const deliveredMatch = (R) => ({
  "device.mobileStatus": { $in: DELIVERED },
  $or: [{ "service.deliveryDate": R }, { "service.deliveryDate": { $in: [null] }, updatedAt: R }],
});
const repairedMatch = (R) => ({
  "device.mobileStatus": { $in: DONE },
  $or: [{ "service.repairDate": R }, { "service.repairDate": { $in: [null] }, updatedAt: R }],
});
const openMatch = { isCancelled: { $ne: true }, "device.mobileStatus": { $nin: DONE } };

// turnaround (days) for delivered jobs: created -> delivered
const tatDays = { $divide: [{ $subtract: [deliveredAt, "$createdAt"] }, DAY] };
const tatOk   = { $gte: [deliveredAt, "$createdAt"] };

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function parseRange(q) {
  const today = istToday();
  const from  = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : today.slice(0, 8) + "01";
  const to    = /^\d{4}-\d{2}-\d{2}$/.test(q.to   || "") ? q.to   : today;
  let a = new Date(`${from}T00:00:00+05:30`);
  let b = new Date(`${to}T23:59:59.999+05:30`);
  if (b < a) [a, b] = [b, a];
  return { from: a, to: b, fromStr: from, toStr: to };
}

/* ---------- period KPIs (current + previous period) ---------- */
async function periodKpis(from, to) {
  const R = rng(from, to);
  const [bookings, delivered, cancelled, rev, tat, fb] = await Promise.all([
    JobSheet.countDocuments(createdMatch(R)),
    JobSheet.countDocuments(deliveredMatch(R)),
    JobSheet.countDocuments(cancelledMatch(R)),
    JobSheet.aggregate([
      { $match: { "service.revenueEntries.date": R } },
      { $unwind: "$service.revenueEntries" },
      { $match: { "service.revenueEntries.date": R } },
      { $group: { _id: null, income: { $sum: "$service.revenueEntries.income" }, profit: { $sum: "$service.revenueEntries.service" } } },
    ]),
    JobSheet.aggregate([
      { $match: deliveredMatch(R) },
      { $group: {
          _id: null,
          sum: { $sum: { $cond: [tatOk, tatDays, 0] } },
          n:   { $sum: { $cond: [tatOk, 1, 0] } },
      } },
    ]),
    Feedback.aggregate([
      { $match: { state: "done", collectedAt: R } },
      { $group: {
          _id: null,
          done: { $sum: 1 },
          rs:   { $sum: { $ifNull: ["$rating", 0] } },
          rn:   { $sum: { $cond: [{ $gt: ["$rating", 0] }, 1, 0] } },
      } },
    ]),
  ]);
  const r = rev[0] || {}, t = tat[0] || {}, f = fb[0] || {};
  return {
    bookings, delivered, cancelled,
    income:     Math.round(r.income || 0),
    profit:     Math.round(r.profit || 0),
    avgTat:     t.n ? +(t.sum / t.n).toFixed(1) : null,
    fbDone:     f.done || 0,
    avgRating:  f.rn ? +(f.rs / f.rn).toFixed(2) : null,
  };
}

/* ---------- per-dimension table (service rep / engineer) ---------- */
async function dimensionRows(R, dimPath, fbRows, extra = {}) {
  const grp = (match, more = {}) => JobSheet.aggregate([
    { $match: match },
    { $group: { _id: keyExpr(dimPath), name: { $first: nameExpr(dimPath) }, count: { $sum: 1 }, ...more } },
  ]);

  const [created, repaired, delivered, cancelled, open, revenue] = await Promise.all([
    grp(createdMatch(R)),
    grp(repairedMatch(R)),
    grp(deliveredMatch(R), {
      tatSum: { $sum: { $cond: [tatOk, tatDays, 0] } },
      tatN:   { $sum: { $cond: [tatOk, 1, 0] } },
    }),
    grp(cancelledMatch(R)),
    JobSheet.aggregate([
      { $match: openMatch },
      { $addFields: { _age: { $divide: [{ $subtract: ["$$NOW", "$createdAt"] }, DAY] } } },
      { $group: {
          _id: keyExpr(dimPath), name: { $first: nameExpr(dimPath) },
          open: { $sum: 1 },
          o3:   { $sum: { $cond: [{ $gte: ["$_age", 3] },  1, 0] } },
          o7:   { $sum: { $cond: [{ $gte: ["$_age", 7] },  1, 0] } },
          o14:  { $sum: { $cond: [{ $gte: ["$_age", 14] }, 1, 0] } },
      } },
    ]),
    JobSheet.aggregate([
      { $match: { "service.revenueEntries.date": R } },
      { $unwind: "$service.revenueEntries" },
      { $match: { "service.revenueEntries.date": R } },
      { $group: {
          _id: keyExpr(dimPath), name: { $first: nameExpr(dimPath) },
          income: { $sum: "$service.revenueEntries.income" },
          profit: { $sum: "$service.revenueEntries.service" },
      } },
    ]),
  ]);

  const rows = new Map();
  const row = (k, name) => {
    if (!rows.has(k)) rows.set(k, {
      name, bookings: 0, repaired: 0, delivered: 0, cancelled: 0,
      open: 0, o3: 0, o7: 0, o14: 0, income: 0, profit: 0,
      tatSum: 0, tatN: 0, fbDone: 0, fbRs: 0, fbRn: 0, low: 0, cases: 0,
    });
    return rows.get(k);
  };

  created.forEach((r)   => (row(r._id, r.name).bookings  += r.count));
  repaired.forEach((r)  => (row(r._id, r.name).repaired  += r.count));
  cancelled.forEach((r) => (row(r._id, r.name).cancelled += r.count));
  delivered.forEach((r) => { const o = row(r._id, r.name); o.delivered += r.count; o.tatSum += r.tatSum; o.tatN += r.tatN; });
  open.forEach((r)      => Object.assign(row(r._id, r.name), { open: r.open, o3: r.o3, o7: r.o7, o14: r.o14 }));
  revenue.forEach((r)   => { const o = row(r._id, r.name); o.income += r.income; o.profit += r.profit; });
  (fbRows || []).forEach((r) => { const o = row(r._id, r.name); o.fbDone = r.n; o.fbRs = r.rs; o.fbRn = r.rn; o.low = r.low; });
  (extra.cases || []).forEach((r) => (row(r._id, r.name).cases = r.n));

  return [...rows.values()]
    .map((o) => ({
      name: o.name,
      bookings: o.bookings, repaired: o.repaired, delivered: o.delivered, cancelled: o.cancelled,
      open: o.open, o3: o.o3, o7: o.o7, o14: o.o14,
      income: Math.round(o.income), profit: Math.round(o.profit),
      avgTat: o.tatN ? +(o.tatSum / o.tatN).toFixed(1) : null,
      fbDone: o.fbDone,
      rating: o.fbRn ? +(o.fbRs / o.fbRn).toFixed(2) : null,
      low: o.low, cases: o.cases,
    }))
    .sort((a, b) => b.bookings - a.bookings || b.open - a.open || b.income - a.income);
}

/* ---------- trend (bookings vs delivered per day / month) ---------- */
async function trend(from, to) {
  const R = rng(from, to);
  const monthly = (to - from) / DAY > 92;
  const fmt = monthly ? "%Y-%m" : "%Y-%m-%d";
  const byDay = (match, dateExpr) => JobSheet.aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: fmt, date: dateExpr, timezone: TZ } }, n: { $sum: 1 } } },
  ]);
  const [b, d] = await Promise.all([byDay(createdMatch(R), "$createdAt"), byDay(deliveredMatch(R), deliveredAt)]);
  const map = new Map();
  const put = (k, f, n) => { if (!map.has(k)) map.set(k, { date: k, bookings: 0, delivered: 0 }); map.get(k)[f] = n; };
  b.forEach((r) => put(r._id, "bookings", r.n));
  d.forEach((r) => put(r._id, "delivered", r.n));

  if (!monthly) {  // fill empty days with 0
    const cur = new Date(from.getTime() + 5.5 * 3600 * 1000);
    const end = new Date(to.getTime()   + 5.5 * 3600 * 1000);
    for (let t = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate());
         t <= end.getTime(); t += DAY) {
      const k = new Date(t).toISOString().slice(0, 10);
      if (!map.has(k)) map.set(k, { date: k, bookings: 0, delivered: 0 });
    }
  }
  return { monthly, points: [...map.values()].sort((x, y) => (x.date < y.date ? -1 : 1)) };
}

/* ---------- feedback block ---------- */
const fbGroup = (path) => ({
  _id: keyExpr(path), name: { $first: nameExpr(path) },
  n:   { $sum: 1 },
  rs:  { $sum: { $ifNull: ["$rating", 0] } },
  rn:  { $sum: { $cond: [{ $gt: ["$rating", 0] }, 1, 0] } },
  low: { $sum: { $cond: [{ $and: [{ $gt: ["$rating", 0] }, { $lte: ["$rating", 2] }] }, 1, 0] } },
});

async function feedbackBlock(from, to) {
  const R = rng(from, to);
  const [facet, attempts, unreachable, casesNew, casesOpen, casesEsc, caseRep] = await Promise.all([
    Feedback.aggregate([
      { $match: { state: "done", collectedAt: R } },
      { $facet: {
          total: [{ $group: {
            _id: null, n: { $sum: 1 },
            rs: { $sum: { $ifNull: ["$rating", 0] } },
            rn: { $sum: { $cond: [{ $gt: ["$rating", 0] }, 1, 0] } },
            low: { $sum: { $cond: [{ $and: [{ $gt: ["$rating", 0] }, { $lte: ["$rating", 2] }] }, 1, 0] } },
            flagged: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$flags", []] } }, 0] }, 1, 0] } },
          } }],
          dist:      [{ $match: { rating: { $gte: 1, $lte: 5 } } }, { $group: { _id: "$rating", n: { $sum: 1 } } }],
          flags:     [{ $unwind: "$flags" }, { $group: { _id: "$flags", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }],
          scenarios: [{ $group: { _id: "$scenario", n: { $sum: 1 } } }],
          employees: [{ $group: fbGroup("$collectedBy.name") }],
          engineers: [{ $group: fbGroup("$engineer") }],
          reps:      [{ $group: fbGroup("$serviceRep") }],
      } },
    ]),
    Feedback.aggregate([
      { $match: { "callAttempts.at": R } },
      { $unwind: "$callAttempts" },
      { $match: { "callAttempts.at": R } },
      { $group: { _id: keyExpr("$callAttempts.by"), name: { $first: nameExpr("$callAttempts.by") }, n: { $sum: 1 } } },
    ]),
    Feedback.countDocuments({ state: "unreachable", updatedAt: R }),
    FeedbackCase.countDocuments({ createdAt: R }),
    FeedbackCase.countDocuments({ status: { $in: ["open", "seen"] } }),
    FeedbackCase.countDocuments({ status: { $ne: "closed" }, escalated: true }),
    FeedbackCase.aggregate([
      { $match: { status: { $in: ["open", "seen"] } } },
      { $group: { _id: keyExpr("$serviceRep"), name: { $first: nameExpr("$serviceRep") }, n: { $sum: 1 } } },
    ]),
  ]);

  const f = facet[0] || {};
  const t = (f.total && f.total[0]) || {};

  // employee table = collected + attempts
  const emp = new Map();
  const e = (k, name) => { if (!emp.has(k)) emp.set(k, { name, collected: 0, attempts: 0, rs: 0, rn: 0 }); return emp.get(k); };
  (f.employees || []).forEach((r) => { const o = e(r._id, r.name); o.collected = r.n; o.rs = r.rs; o.rn = r.rn; });
  attempts.forEach((r) => (e(r._id, r.name).attempts = r.n));

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  (f.dist || []).forEach((r) => (dist[r._id] = r.n));

  return {
    done: t.n || 0,
    avgRating: t.rn ? +(t.rs / t.rn).toFixed(2) : null,
    lowRatings: t.low || 0,
    flagged: t.flagged || 0,
    attempts: attempts.reduce((s, r) => s + r.n, 0),
    unreachable,
    dist,
    flags: (f.flags || []).map((r) => ({ key: r._id, n: r.n })),
    scenarios: (f.scenarios || []).map((r) => ({ key: r._id, n: r.n })),
    employees: [...emp.values()]
      .map((o) => ({ name: o.name, collected: o.collected, attempts: o.attempts, rating: o.rn ? +(o.rs / o.rn).toFixed(2) : null }))
      .sort((a, b) => b.collected - a.collected || b.attempts - a.attempts),
    cases: { created: casesNew, open: casesOpen, escalated: casesEsc },
    _engineers: f.engineers || [],
    _reps: f.reps || [],
    _caseRep: caseRep,
  };
}

/* ---------- GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD ---------- */
exports.getOverview = async (req, res) => {
  try {
    const { from, to, fromStr, toStr } = parseRange(req.query);
    const R = rng(from, to);

    const span     = Math.max(to - from, DAY);
    const prevTo   = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - span);

    const [kpi, prev, tr, fb, openNow, stale7] = await Promise.all([
      periodKpis(from, to),
      periodKpis(prevFrom, prevTo),
      trend(from, to),
      feedbackBlock(from, to),
      JobSheet.countDocuments(openMatch),
      JobSheet.countDocuments({ ...openMatch, createdAt: { $lte: new Date(Date.now() - 7 * DAY) } }),
    ]);

    const [reps, engineers] = await Promise.all([
      dimensionRows(R, "$service.serviceRep", fb._reps, { cases: fb._caseRep }),
      dimensionRows(R, "$service.engineer",   fb._engineers),
    ]);
    delete fb._engineers; delete fb._reps; delete fb._caseRep;

    res.json({
      range: { from: fromStr, to: toStr },
      kpi:  { ...kpi, openNow, stale7 },
      prev,
      trend: tr,
      reps,
      engineers,
      feedback: fb,
    });
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};