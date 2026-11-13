const express = require("express");
const router  = express.Router();

const JobSheet = require("../models/JobSheet");
const upload   = require("../middleware/upload");

const generateInvoicePDF = require("../utils/generateInvoicePDF");
const sendEmail          = require("../utils/sendEmail");
const { sendJobStatusWhatsApp } = require("../utils/sendWhatsApp"); // ✅ WhatsApp

const {
  sendEstimateEmail,
  updateJobSheet,
  getJobSheetById,
  getUserReport,
} = require("../controllers/jobSheetController");


/* =====================================================
   WORKLOAD HELPER — simple 1 job = 1 point
===================================================== */
const getEngineerLoad = async (name) => {
  const count = await JobSheet.countDocuments({
    "service.engineer": name,
    "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
    isInvoiced: { $ne: true },
  });
  return count;
};

router.get("/user-report", getUserReport);

/* =====================================================
   WORKLOAD API
===================================================== */
router.get("/workload", async (req, res) => {
  try {
    const activeJobs = await JobSheet.find({
      "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
      isInvoiced: { $ne: true },
    }).select("service.engineer");

    const countMap = {};
    for (const job of activeJobs) {
      const eng = job.service?.engineer;
      if (eng) countMap[eng] = (countMap[eng] || 0) + 1;
    }

    res.json(Object.entries(countMap).map(([name, activeJobs]) => ({ name, activeJobs })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   STALE JOBS API
===================================================== */
router.get("/stale", async (req, res) => {
  try {
    const days = parseInt(req.query.days || "3");

    const jobs = await JobSheet.find({
      "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired", "Cancelled"] },
      "service.drawer": { $nin: ["Return"] },   // ✅ Return drawer exclude
      isCancelled: { $ne: true },               // ✅ Cancelled jobs exclude
      isInvoiced: { $ne: true }
    }).select("jobSheetNo customer device service statusLogs repairSteps createdAt");

    const staleJobs = [];
    for (const job of jobs) {
      const dates = [new Date(job.createdAt)];
      if (job.statusLogs?.length > 0) {
        const last = job.statusLogs[job.statusLogs.length - 1];
        if (last.timestamp) dates.push(new Date(last.timestamp));
      }
      if (job.repairSteps?.length > 0) {
        job.repairSteps.forEach(s => { if (s.completedAt) dates.push(new Date(s.completedAt)); });
      }
      const lastActivity = new Date(Math.max(...dates));
      const diffDays = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= days) {
        staleJobs.push({
          _id: job._id, jobSheetNo: job.jobSheetNo,
          customerName: job.customer?.name || "-",
          contact: job.customer?.contact || "-",
          make: job.device?.make || "-", model: job.device?.model || "-",
          status: job.device?.mobileStatus || "-",
          engineer: job.service?.engineer || "-",
          assignedTo: job.service?.engineer || "-",
          lastActivity, staleDays: diffDays,
        });
      }
    }
    staleJobs.sort((a, b) => b.staleDays - a.staleDays);
    res.json(staleJobs);
  } catch (err) {
    console.error("STALE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   FILTER JOBSHEETS
===================================================== */
router.get("/filter", async (req, res) => {
  try {
    const { status, fromDate, toDate, q, engineer, dealer } = req.query;
    let query = {};

    if (q) {
      const trimmed = q.trim();

      // Job Sheet No — exact match (234 → JS-234, or JS-234 directly)
      const isJobNo = /^\d{1,4}$/.test(trimmed) || /^JS-\d+$/i.test(trimmed);
      if (isJobNo) {
        const normalized = /^JS-/i.test(trimmed)
          ? trimmed.toUpperCase()
          : `JS-${trimmed.padStart(3, "0")}`;
        query.jobSheetNo = normalized;
      }
      // IMEI — exact 15 digit match
      else if (/^\d{15}$/.test(trimmed)) {
        query["device.imei"] = trimmed;
      }
      // Contact — exact 10 digit match
      else if (/^\d{10}$/.test(trimmed)) {
        query["customer.contact"] = trimmed;
      }
      // Name — partial match
      else {
        query["customer.name"] = { $regex: trimmed, $options: "i" };
      }
    }
    if (status) query["device.mobileStatus"] = status;
    if (dealer) query["service.dealer"] = { $regex: dealer, $options: "i" };

    if (engineer) {
      const engRegex = { $regex: engineer.trim(), $options: "i" };
      if (query.$or) {
        const textOr = query.$or;
        delete query.$or;
        query.$and = [
          { $or: textOr },
          { "service.engineer": engRegex }
        ];
      } else {
        query["service.engineer"] = engRegex;
      }
    }

       // ✅ FIX — Date filter ஒரு field மேல மட்டும் apply ஆகும்: createdAt.
    // முன்பு revenueEntries.date / spareItems.date-உம் சேர்த்து $or பண்ணி,
    // Aug-ல create ஆன job Sep-ல rebill/spare-update ஆனா, அந்த job Sep
    // filter-லயும் தெரிஞ்சு (Date column-ல Aug காட்டி) குழப்பம் தந்துச்சு.
    // Income-ஐ date range-வாரியா பாக்க Value Report already இருக்கு —
    // All Report இப்போ createdAt-ஐ மட்டும் strict-ஆ filter பண்ணும்.
    if (fromDate || toDate) {
      const start = fromDate ? new Date(fromDate) : null;
      if (start) start.setHours(0, 0, 0, 0);
      const end = toDate ? new Date(toDate) : new Date();
      end.setHours(23, 59, 59, 999);

      const createdAtCond = { $lte: end };
      if (start) createdAtCond.$gte = start;

      if (query.$and) {
        query.$and.push({ createdAt: createdAtCond });
      } else if (query.$or) {
        query.$and = [{ $or: query.$or }, { createdAt: createdAtCond }];
        delete query.$or;
      } else {
        query.createdAt = createdAtCond;
      }
    }

    const data = await JobSheet.find(query).sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    console.error("FILTER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   NEXT JOB NUMBER
===================================================== */
router.get("/next-number", async (req, res) => {
  try {
    const allJobs = await JobSheet.find().select("jobSheetNo");
    if (!allJobs.length) return res.json({ next: "JS-001" });
    const numbers = allJobs.map(job => {
      const num = parseInt(String(job.jobSheetNo).replace(/\D/g, ""));
      return isNaN(num) ? 0 : num;
    });
    return res.json({ next: `JS-${String(Math.max(...numbers) + 1).padStart(3, "0")}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   CREATE NEW JOB SHEET
   (⭐ this is the ONLY create implementation — controller's createJobSheet
   was dead code, never wired to a route, and has been removed to avoid
   confusion/duplicate edits going forward.)

   🔴 FIX (this file) — rawSpareItems was never destructured from req.body
   and never assigned onto newJob, so Raw Spare items added on a BRAND NEW
   job sheet (before the very first Save) were silently dropped and never
   reached the DB at all. Now parsed + saved exactly like spareItems.
===================================================== */
router.post("/", upload.single("idProofImage"), async (req, res) => {
  try {
    const {
      jobSheetNo, customer, device, physicalCondition,
      accessories, advanceItems, visualIssues, service,
      spareItems, rawSpareItems, idProofType, createdBy   // ✅ rawSpareItems added
    } = req.body;

    // advanceItems comes as its own FormData field from the frontend, but the
    // schema expects it nested inside "service". Merge it in here, otherwise it
    // silently gets dropped and Advance Report shows nothing.
    const parsedService = JSON.parse(service || "{}");
    parsedService.advanceItems = JSON.parse(advanceItems || "[]");

    // ✅ FIX — seed revenueEntries at creation too, mirroring updateJobSheet's rebuild.
    // Without this, a job saved ONCE with Income/Service already filled never gets a
    // ledger entry until someone later CHANGES the amount — silently dropping
    // Service/Income from every Transaction-Date report (My Report / Value Report)
    // even though the job genuinely earned it on day one.
    const initService = Number(parsedService.serviceCharge || 0);
    const initIncome  = Number(parsedService.income || 0);
    if (initService > 0 || initIncome > 0) {
      const entryDate = parsedService.incomeDate
        ? new Date(`${parsedService.incomeDate}T00:00:00`)
        : new Date();
      parsedService.revenueEntries = [{
        date: entryDate,
        service: initService,
        spare: 0,
        income: initIncome,
        others: 0,
      }];
    }

    const newJob = new JobSheet({
      jobSheetNo,
      customer:          JSON.parse(customer || "{}"),
      device:            JSON.parse(device || "{}"),
      physicalCondition: JSON.parse(physicalCondition || "[]"),
      accessories:       JSON.parse(accessories || "[]"),
      visualIssues:      JSON.parse(visualIssues || "[]"),
      service:           parsedService,
      spareItems:        JSON.parse(spareItems || "[]"),
      rawSpareItems:      JSON.parse(rawSpareItems || "[]"),   // ✅ FIX — now actually saved
          idProofType,
      engineerStatus: ({ Received: "Received", Pending: "Repairing", Repaired: "Ready" })[JSON.parse(device || "{}").mobileStatus] || "Received",
      createdBy:         JSON.parse(createdBy || "{}"),
    });

    if (req.file) {
      newJob.idProofImage = {
        url: req.file.path || req.file.location,
        public_id: req.file.filename || req.file.public_id,
      };
    }

    await newJob.save();

    // ✅ WhatsApp status message on initial save (e.g. Device Status = "Received").
    // Fire-and-forget: doesn't block the response, doesn't fail the save if WhatsApp errors.
    if (newJob.customer?.contact && newJob.device?.mobileStatus) {
      sendJobStatusWhatsApp(
        newJob.customer.contact,
        newJob.customer.name,
        newJob.jobSheetNo,
        newJob.device.mobileStatus
      );
    }

    res.json({ message: "Job Sheet Saved ✅", job: newJob });
  } catch (err) {
    console.error("CREATE JOBSHEET ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   MANUAL SEND WHATSAPP — triggered by the "Send WhatsApp" button on the
   Job Sheet page. Re-sends the message for whatever Device Status the job
   currently has, regardless of whether the status actually changed (unlike
   the automatic triggers elsewhere in this file, which only fire on change).
   Useful when the first automatic send failed (e.g. WHATSAPP_TOKEN was down)
   or the shop just wants to manually remind a customer.
===================================================== */
router.post("/:id/send-whatsapp", async (req, res) => {
  try {
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (!job.customer?.contact) {
      return res.status(400).json({ message: "Customer contact number not available" });
    }

    const status = job.device?.mobileStatus;
    if (!status) {
      return res.status(400).json({ message: "Device Status not set on this job sheet" });
    }

    const sent = await sendJobStatusWhatsApp(
      job.customer.contact,
      job.customer.name,
      job.jobSheetNo,
      status
    );

    if (sent) {
      res.json({ message: `WhatsApp sent ✅ (status: ${status})` });
    } else {
      // sendJobStatusWhatsApp returns false for unmapped statuses (e.g. "Cancelled")
      // or invalid contact numbers — not a server error, just nothing to send.
      res.status(400).json({ message: `No WhatsApp message is configured for status "${status}", or the contact number is invalid` });
    }
  } catch (err) {
    console.error("SEND WHATSAPP ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});



/* =====================================================
   REBILL — Reopen an invoiced job for re-repair

   🔴 REWRITTEN (this file) — the snapshot now captures the FULL picture of
   the cycle that's ending: income, balance, service charge, spare, raw
   spare, others, advance, payment mode, engineer, drawer, dealer, service
   rep, repair date, delivery date. Everything goes into rebillHistory so a
   Rebill Report can show exactly what each past cycle looked like.

   After the snapshot is taken, only the BILLING fields reset for the new
   cycle — service charge, spare (baseline-based, stays 0 net), raw spare
   (baseline-based, stays 0 net — this is NEW, see rawSpareBaseline below),
   others (baseline-based), advance (baseline-based), income, balance, and
   payment mode. Engineer / drawer / dealer / service rep / repair date /
   delivery date are captured for the record but deliberately NOT reset —
   they're assignment/scheduling fields, not billing fields, and a rebill
   doesn't mean "reassign the job".

   ✅ FIX — Balance and Payment Mode were never reset here before; they'd
   carry the OLD cycle's numbers into the new cycle indefinitely. Now reset.

   ✅ FIX — Raw Spare had no baseline/cycle-split concept at all (unlike
   Spare/Others/Advance), so "Raw Spare (Shop)" always showed the FULL
   lifetime total even right after a rebill. rawSpareBaseline now mirrors
   spareBaseline exactly: rawSpareItems array stays cumulative (full
   history, shown grayed-out as "Before Rebill" in the popup), but the
   baseline snapshot makes the outer field's NET total show empty for the
   new cycle until new raw spare items are added.
===================================================== */
router.put("/:id/rebill", async (req, res) => {
  try {
    const { rebilledBy } = req.body;
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.isInvoiced) return res.status(400).json({ message: "Job is not invoiced yet" });

    const currentIncome      = Number(job.service?.income        || 0);
    const currentService     = Number(job.service?.serviceCharge || 0);
    const currentSpare       = Number(job.service?.spareCharge   || 0);
    const currentOthers      = Number(job.service?.othersAmount  || 0);
    const currentAdvance     = Number(job.service?.advanceAmount || 0);
    const currentBalance     = Number(job.service?.balance       || 0);
    const currentBalanceDate = job.service?.balanceDate || null;
    const currentPaymentMode = job.service?.paymentMode || "";
    const currentRemarks     = job.service?.remarks || "";
    const currentStatus      = job.device?.mobileStatus || "";

    // ✅ Captured for the record only — these are assignment/schedule fields,
    // not billing fields, so they are NOT reset below.
    const currentEngineer     = job.service?.engineer     || "";
    const currentDrawer       = job.service?.drawer       || "";
    const currentDealer       = job.service?.dealer       || "";
    const currentServiceRep   = job.service?.serviceRep   || "";
    const currentRepairDate   = job.service?.repairDate   || null;
    const currentDeliveryDate = job.service?.deliveryDate || null;

    // ✅ spareItems / othersItems / rawSpareItems arrays themselves are untouched
    // by rebill (stay cumulative — full history across every cycle), so each
    // charge should always equal the sum of its own items array, never hard-reset.
    const spareTotal = (job.spareItems || []).reduce((s, it) => s + Number(it.amount || 0), 0);
    const othersTotal = (job.service?.othersItems || []).reduce((s, it) => s + Number(it.amount || 0), 0);
    // ✅ NEW — Raw Spare total, same cumulative pattern as spareItems/othersItems
    const rawSpareTotal = (job.rawSpareItems || []).reduce((s, it) => s + Number(it.amount || 0), 0);

    const beforeRebillSnapshot = {
      rebilledAt:    new Date(),
      rebilledBy:    rebilledBy || "admin",
      income:        currentIncome,
      incomeDate:    job.service?.incomeDate || null,
      balance:       currentBalance,          // ✅ NEW — captured
      balanceDate:   currentBalanceDate,      // ✅ NEW — captured
      serviceCharge: currentService,
      spareCharge:   currentSpare,
      rawSpareCharge: rawSpareTotal,          // ✅ NEW — captured
      othersAmount:  currentOthers,
      advanceAmount: currentAdvance,
      paymentMode:   currentPaymentMode,      // ✅ NEW — captured
      engineer:      currentEngineer,         // ✅ NEW — captured (not reset)
      drawer:        currentDrawer,           // ✅ NEW — captured (not reset)
      dealer:        currentDealer,           // ✅ NEW — captured (not reset)
      serviceRep:    currentServiceRep,       // ✅ NEW — captured (not reset)
      repairDate:    currentRepairDate,       // ✅ NEW — captured (not reset)
      deliveryDate:  currentDeliveryDate,     // ✅ NEW — captured (not reset)
      remarks:       currentRemarks,
      status:        currentStatus,
    };

    await JobSheet.findByIdAndUpdate(req.params.id, {
      $set: {
        isInvoiced: false,
        rebillPending: true,
              "device.mobileStatus": "Received",
        engineerStatus: "Received",
        "service.serviceCharge": 0,
        "service.spareCharge": spareTotal,
        "service.spareBaseline": currentSpare,
        "service.rawSpareBaseline": rawSpareTotal,   // ✅ NEW — Raw Spare now shows empty this cycle
        "service.advanceBaseline": currentAdvance,
        "service.othersBaseline": currentOthers,
        "service.income": 0,
        "service.incomeDate": null,
        "service.balance": 0,                        // ✅ FIX — was never reset before
        "service.balanceDate": null,                 // ✅ FIX — was never reset before
        "service.paymentMode": "",                    // ✅ FIX — was never reset before
        "service.othersAmount": othersTotal,
        "service.remarks": "",
        // engineer / drawer / dealer / serviceRep / repairDate / deliveryDate are
        // deliberately absent here — not reset, per the note above.
      },
      $push: {
        statusLogs: {
          status: "Received",
          updatedBy: rebilledBy || "admin",
          timestamp: new Date(),
          note: "Rebill opened",
        },
        rebillHistory: beforeRebillSnapshot,   // ✅ full before-rebill snapshot
      },
    });

    const updated = await JobSheet.findById(req.params.id);

    // ✅ rebill resets status back to "Received", customer should know their
    // device is back in the shop for another round of repair.
    if (updated.customer?.contact) {
      sendJobStatusWhatsApp(
        updated.customer.contact,
        updated.customer.name,
        updated.jobSheetNo,
        "Received"
      );
    }

    res.json(updated);
  } catch (err) {
    console.error("REBILL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});











/* =====================================================
   MANUAL JOB SHEET INSERT (specific number)
   NOTE: no WhatsApp trigger here on purpose — this is for backfilling old/manual
   jobs, not new intake, so customers shouldn't get a notification for it. If you
   want customers notified here too, add a sendJobStatusWhatsApp() call after save,
   same pattern as the routes above.

   🔴 FIX (this file) — this route was completely broken: it destructured
   individual flat fields (customerName, contact, make, model, issue...) from
   req.body, but then tried to build newJob from `customer`, `device`,
   `physicalCondition`, `service`, `spareItems`, `idProofType`, `createdBy` —
   none of which were ever defined, so this route would throw a
   ReferenceError on every call. Rewritten to actually use the fields it
   receives, matching the flat shape the destructuring implies, and now also
   saves rawSpareItems if sent.
===================================================== */
router.post('/manual-insert', async (req, res) => {
  try {
    const {
      jobSheetNo, customerName, contact, make, model,
      issue, engineer, serviceRep, serviceCharge,
      repairDate, deliveryDate, rawSpareItems
    } = req.body;

    // Already exists check
    const existing = await JobSheet.findOne({ jobSheetNo });
    if (existing) {
      return res.status(400).json({ message: `${jobSheetNo} already exists` });
    }

    const newJob = new JobSheet({
      jobSheetNo,
      customer: { name: customerName, contact },
      device:   { make, model },
      visualIssues: issue ? [issue] : [],
      service: {
        engineer, serviceRep,
        serviceCharge: Number(serviceCharge || 0),
        repairDate, deliveryDate,
      },
      rawSpareItems: JSON.parse(rawSpareItems || "[]"),
    });
    await newJob.save();
    res.json({ message: 'Inserted ✅', job: newJob });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Insert failed', error: err.message });
  }
});

/* =====================================================
   STATUS UPDATE
===================================================== */
router.patch("/:id/status", async (req, res) => {
  try {
    const { status, updatedBy } = req.body;
    const job = await JobSheet.findByIdAndUpdate(
      req.params.id,
      { engineerStatus: status, $push: { statusLogs: { status, updatedBy, timestamp: new Date() } } },
      { new: true }
    );

    res.json(job);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
/* =====================================================
   REPAIR STEPS
===================================================== */
router.post("/:id/steps", async (req, res) => {
  try {
    const { step, note, completedBy } = req.body;
    const job = await JobSheet.findByIdAndUpdate(
      req.params.id,
      { $push: { repairSteps: { step, note, done: false, completedBy, completedAt: null } } },
      { new: true }
    );
    res.json(job);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.patch("/:id/steps/:stepId", async (req, res) => {
  try {
    const { done, completedBy } = req.body;
    const job = await JobSheet.findOneAndUpdate(
      { _id: req.params.id, "repairSteps._id": req.params.stepId },
      { $set: { "repairSteps.$.done": done, "repairSteps.$.completedBy": completedBy, "repairSteps.$.completedAt": done ? new Date() : null } },
      { new: true }
    );
    res.json(job);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete("/:id/steps/:stepId", async (req, res) => {
  try {
    const job = await JobSheet.findByIdAndUpdate(
      req.params.id,
      { $pull: { repairSteps: { _id: req.params.stepId } } },
      { new: true }
    );
    res.json(job);
  } catch (err) { res.status(500).json({ message: err.message }); }
});


/* =====================================================
   EMAIL
===================================================== */
router.post("/send-invoice/:id", async (req, res) => {
  try {
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.customer?.email) return res.status(400).json({ message: "Customer email not available" });
    const pdfBuffer = await generateInvoicePDF(job);
    const total = Number(job.service?.serviceCharge || 0) + Number(job.service?.spareCharge || 0);
    await sendEmail(
      job.customer.email, `Invoice - ${job.jobSheetNo}`,
      `Dear ${job.customer.name},\n\nYour device service has been completed.\n\nInvoice No: ${job.jobSheetNo}\nTotal Amount: ₹${total}\n\nThank you for choosing Radnus Communication.`,
      pdfBuffer, `Invoice-${job.jobSheetNo}.pdf`
    );
    res.json({ message: "Invoice sent successfully ✅" });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

/* =====================================================
   SALESREP REPORT
===================================================== */
router.get("/salesrep-report", async (req, res) => {
  try {
    const { salesRep, fromDate, toDate } = req.query;
    const query = {};

    if (salesRep) {
      query["service.serviceRep"] = { $regex: salesRep.trim(), $options: "i" };
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const jobs = await JobSheet.find(query).sort({ createdAt: -1 });

    const grouped = {};
    for (const job of jobs) {
      const rep = job.service?.serviceRep?.trim() || "Unassigned";
      if (!grouped[rep]) grouped[rep] = [];
      grouped[rep].push(job);
    }

    res.json(grouped);
  } catch (err) {
    console.error("SALESREP REPORT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.post("/send-estimate/:id", sendEstimateEmail);

/* =====================================================
   INVOICE LOCK
===================================================== */
router.put("/:id/invoice", async (req, res) => {
  try {
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const currentStatus = job.device?.mobileStatus;
    const finalStatus =
      currentStatus === "Delivered NR/NA" ? "Delivered NR/NA" : "Delivered";

     const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        isInvoiced: true,
        rebillPending: false,   // ✅ FIX — invoice பண்றது rebill cycle-ஐ முடிச்சிடும்.
                                 // Update click பண்ணாம நேரடியா Invoice பண்ணினாலும்
                                 // "Save Rebill" label அடுத்த தடவை தப்பா காட்டாம இருக்க.
        "device.mobileStatus": finalStatus,
      },
      { new: true }
    );

    // ✅ Invoice button moves status to "Delivered" (or leaves "Delivered NR/NA"),
    // which the customer should be notified about. "Delivered NR/NA" isn't in the
    // STATUS_MESSAGES map, so sendJobStatusWhatsApp silently skips it — only a genuine
    // "Delivered" triggers a message here.
    if (updated?.customer?.contact) {
      sendJobStatusWhatsApp(
        updated.customer.contact,
        updated.customer.name,
        updated.jobSheetNo,
        finalStatus
      );
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Error locking invoice" });
  }
});

/* =====================================================
   SPARES
===================================================== */
router.put("/:id/spares", async (req, res) => {
  try {
    const { spareItems } = req.body;
    const total = spareItems.reduce((sum, item) => sum + item.amount, 0);
    const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      { spareItems, "service.spareCharge": total },
      { new: true }
    );
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* =====================================================
   CUSTOMER AUTOCOMPLETE
===================================================== */
router.get("/customers/search", async (req, res) => {
  try {
    const { q, type } = req.query;
    if (!q || q.trim().length < 1) return res.json([]);

    const searchRegex = new RegExp("^" + q.trim(), "i");

    let matchQuery = {};
    if (type === "contact") {
      matchQuery = { "customer.contact": searchRegex };
    } else {
      matchQuery = { "customer.name": searchRegex };
    }

    const customers = await JobSheet.aggregate([
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { name: "$customer.name", contact: "$customer.contact" },
          name:         { $first: "$customer.name" },
          contact:      { $first: "$customer.contact" },
          altContact:   { $first: "$customer.altContact" },
          address:      { $first: "$customer.address" },
          email:        { $first: "$customer.email" },
          instaValues:  { $push: "$service.instaFollowers" },
          googleValues: { $push: "$service.googleReview" },
          lastJobDate:  { $first: "$createdAt" }
        }
      },
      {
        $addFields: {
          instaFollowers: {
            $cond: [
              { $or: [{ $in: ["Already Done", "$instaValues"] }, { $in: ["Yes", "$instaValues"] }] },
              "Already Done", ""
            ]
          },
          googleReview: {
            $cond: [
              { $or: [{ $in: ["Already Done", "$googleValues"] }, { $in: ["Yes", "$googleValues"] }] },
              "Already Done", ""
            ]
          }
        }
      },
      { $sort: { name: 1 } },
      { $limit: 15 }
    ]);

    res.json(customers);
  } catch (err) {
    console.error("CUSTOMER SEARCH ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   CANCEL JOBSHEET
===================================================== */
router.put("/:id/cancel", async (req, res) => {
  try {
    const { cancelRemarks, cancelledBy } = req.body;

    if (!cancelRemarks || !cancelRemarks.trim()) {
      return res.status(400).json({ message: "Cancel remarks is required" });
    }

    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    if (job.isCancelled) {
      return res.status(400).json({ message: "Job is already cancelled" });
    }

    const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        isCancelled:           true,
        cancelRemarks:         cancelRemarks.trim(),
        cancelledBy:           cancelledBy || "admin",
        cancelledAt:           new Date(),
        "device.mobileStatus": "Cancelled",
        $push: {
          statusLogs: {
            status:    "Cancelled",
            updatedBy: cancelledBy || "admin",
            timestamp: new Date(),
            note:      cancelRemarks.trim(),
          },
        },
      },
      { new: true }
    );



    res.json(updated);
  } catch (err) {
    console.error("CANCEL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});
router.patch("/:id/transfer", async (req, res) => {
  try {
    const { from, to, note } = req.body;

    if (!to || !to.trim()) {
      return res.status(400).json({ message: "Target (to) is required" });
    }

    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const isReception = to === "Reception";

    const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        $set: { "service.engineer": isReception ? "" : to },
        $push: {
          transferLog: {
            from: from || "",
            to,
            note: note || "",
            transferredAt: new Date(),
          },
          statusLogs: {
            status: job.device?.mobileStatus || "Received",
            updatedBy: from || "admin",
            timestamp: new Date(),
            note: isReception
              ? `Transferred back to Reception${note ? `: ${note}` : ""}`
              : `Transferred to ${to}${note ? `: ${note}` : ""}`,
          },
        },
      },
      { new: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("TRANSFER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/:id", getJobSheetById);


router.put("/:id", upload.single("idProofImage"), updateJobSheet);

module.exports = router;