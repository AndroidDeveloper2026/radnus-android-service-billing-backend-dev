const generatePDF = require("../utils/generatePDF");
const sendEmail = require("../utils/sendEmail");
const JobSheet = require("../models/JobSheet");
const { sendJobStatusWhatsApp } = require("../utils/sendWhatsApp"); // ✅ WhatsApp




/* ================= GET ALL ================= */
exports.getJobSheets = async (req, res) => {

  try {

    const jobs = await JobSheet.find().sort({ createdAt: -1 });

    res.json(jobs);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

};


/* ================= GET SINGLE ================= */
exports.getJobSheetById = async (req, res) => {

  try {

    const job = await JobSheet.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        message: "Job sheet not found ❌"
      });
    }

    res.json(job);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }

};


/* ================= UPDATE ================= */
exports.updateJobSheet = async (req, res) => {
  try {
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });

    // ✅ capture the OLD status before overwriting, so we know if it actually changed.
    const oldMobileStatus = job.device?.mobileStatus || "";

    // ✅ Parse all JSON fields
    const serviceData        = typeof req.body.service === "string"          ? JSON.parse(req.body.service)          : (req.body.service          || {});

    const customerData       = typeof req.body.customer === "string"         ? JSON.parse(req.body.customer)         : (req.body.customer         || {});
    const deviceData         = typeof req.body.device === "string"           ? JSON.parse(req.body.device)           : (req.body.device           || {});
    const physicalCondition  = typeof req.body.physicalCondition === "string"? JSON.parse(req.body.physicalCondition): (req.body.physicalCondition || []);
    const accessories        = typeof req.body.accessories === "string"      ? JSON.parse(req.body.accessories)      : (req.body.accessories       || []);
    const visualIssues       = typeof req.body.visualIssues === "string"     ? JSON.parse(req.body.visualIssues)     : (req.body.visualIssues      || []);
    const spareItems         = typeof req.body.spareItems === "string"       ? JSON.parse(req.body.spareItems)       : (req.body.spareItems        || []);

    // ✅ NEW — never let a spare item silently lose or regain its date on a
    // routine Update. Match each incoming item to the job's EXISTING spare item
    // (by _id first, then by position). If the incoming item has no date, keep
    // the old one. Only a genuinely NEW item (no match in DB) gets today's date.
    const oldSpareItems = job.spareItems || [];
    const spareItemsWithPreservedDates = spareItems.map((item, idx) => {
      if (item.date) return item; // frontend already sent a real date — trust it
      const old =
        (item._id && oldSpareItems.find(o => String(o._id) === String(item._id))) ||
        oldSpareItems[idx];
      return { ...item, date: old ? old.date : new Date() }; // new item → today
    });

    // ✅ NEW — Raw Spare (shop purchase inventory), same date-preservation
    // pattern as spareItems above.
    const rawSpareItems = typeof req.body.rawSpareItems === "string"
      ? JSON.parse(req.body.rawSpareItems)
      : (req.body.rawSpareItems || []);

    const oldRawSpareItems = job.rawSpareItems || [];
    const rawSpareItemsWithPreservedDates = rawSpareItems.map((item, idx) => {
      if (item.date) return item;
      const old =
        (item._id && oldRawSpareItems.find(o => String(o._id) === String(item._id))) ||
        oldRawSpareItems[idx];
      return { ...item, date: old ? old.date : new Date() };
    });

    const advanceItems = typeof req.body.advanceItems === "string"
      ? JSON.parse(req.body.advanceItems)
      : (req.body.advanceItems || []);

    const oldService = job.service || {};

    // ================= REVENUE-CHANGE GUARD (NEW) =================
    // Snapshot of what Service Charge / Income were BEFORE this save, taken
    // from the DB record we just loaded. Used below to detect whether this
    // save actually changed the money, or was just a status/remarks/engineer
    // edit that happened to re-submit the same amounts.
    const previousServiceCharge = Number(oldService.serviceCharge || 0);
    const previousIncome        = Number(oldService.income        || 0);

    // ✅ Use manually selected Income Date instead of always using today's date.
    const revenueDate = serviceData.incomeDate
      ? new Date(`${serviceData.incomeDate}T00:00:00`)
      : new Date();


    const rebillHistoryArr = job.rebillHistory || [];
    const lastRebill = rebillHistoryArr.length > 0
      ? rebillHistoryArr[rebillHistoryArr.length - 1]
      : null;
    const cycleStart = lastRebill?.rebilledAt ? new Date(lastRebill.rebilledAt) : null;

    const allEntries = oldService.revenueEntries || [];
    const priorCycleEntries = cycleStart
      ? allEntries.filter(e => e.date && new Date(e.date) < cycleStart)
      : [];
    const currentCycleEntries = cycleStart
      ? allEntries.filter(e => e.date && new Date(e.date) >= cycleStart)
      : allEntries;

    const revenueDayKey = revenueDate.toISOString().slice(0, 10);

    // ✅ FIX — stale-entry bug: previously only TODAY's date-key was excluded from
    // "other day" entries. If the user changes the Income Date itself (e.g. typed
    // amount on 18 Sept, then corrected the date to 17 Sept), the OLD 18-Sept entry
    // had a DIFFERENT date-key from the new 17-Sept save, so it was never excluded —
    // it just sat there forever as an "unrelated other day" entry, permanently
    // double-counting in every report. Now we also exclude whatever date-key the
    // job's incomeDate WAS before this save (oldIncomeDateKey), so a changed date
    // properly retires the old entry instead of leaving it behind as a duplicate.
    const oldIncomeDateKey = oldService.incomeDate
      ? new Date(oldService.incomeDate).toISOString().slice(0, 10)
      : null;

    const otherDayEntries = currentCycleEntries.filter((e) => {
      if (!e.date) return true;
      const key = new Date(e.date).toISOString().slice(0, 10);
      if (key === revenueDayKey) return false;               // replaced by today's rebuilt entry
      if (oldIncomeDateKey && key === oldIncomeDateKey) return false; // retire stale old-date entry
      return true;
    });
    const sumOtherDaysService = otherDayEntries.reduce((s, e) => s + Number(e.service || 0), 0);
    const sumOtherDaysIncome  = otherDayEntries.reduce((s, e) => s + Number(e.income  || 0), 0);

    const targetService = Number(serviceData.serviceCharge || 0);
    const targetIncome  = Number(serviceData.income || 0);

    // ================= REVENUE-CHANGE GUARD (NEW) =================
    // 🔴 THE REAL BUG: revenueEntries used to get rebuilt on EVERY save, even
    // when Service Charge / Income never actually changed (e.g. Update was
    // clicked only to change Device Status, Remarks, or Engineer). For an
    // old job that never had revenueEntries before, that meant its FULL
    // historical serviceCharge/income got silently re-dated to TODAY on the
    // very next unrelated Update — corrupting every "Transaction Date"
    // report the moment anyone touches that job again, months later.
    // ✅ FIX — only rebuild revenueEntries when serviceCharge or income
    // genuinely changed THIS save, compared to what was in the DB before.
    const revenueChangedThisSave =
      targetService !== previousServiceCharge || targetIncome !== previousIncome;

    let newRevenueEntries;
    if (!revenueChangedThisSave) {
      // Nothing about the money changed — leave revenueEntries exactly as it
      // was. This is what stops a routine status/remarks/engineer edit from
      // ever injecting a bogus "today" entry for an untouched charge.
      newRevenueEntries = allEntries;
    } else {
      // today's entry = whatever's needed so (other days + today) === the true
      // current total — this is what makes same-day corrections self-heal
      // instead of leaving a stale extra row behind.
      const todayService = Math.max(0, targetService - sumOtherDaysService);
      const todayIncome  = Math.max(0, targetIncome  - sumOtherDaysIncome);

      const rebuiltCurrentCycle = [...otherDayEntries];
      if (todayService > 0 || todayIncome > 0) {
        rebuiltCurrentCycle.push({
          date: revenueDate,
          service: todayService,
          spare: 0,
          income: todayIncome,
          others: 0,
        });
      }

      newRevenueEntries = [...priorCycleEntries, ...rebuiltCurrentCycle];
    }

    // ✅ Build update — service object EXPLICIT-ஆ (எந்த field-உம் miss ஆகாது)
    const updateData = {
      jobSheetNo:        req.body.jobSheetNo,
      customer:          customerData,
      device:            { ...deviceData, idProofType: req.body.idProofType },
      physicalCondition,
      accessories,
      visualIssues,
       spareItems: spareItemsWithPreservedDates,   // ✅ CHANGED — was just "spareItems"
      rawSpareItems: rawSpareItemsWithPreservedDates,  
      service: {
        engineer:       serviceData.engineer       || "",
        softwareEngineer: serviceData.softwareEngineer || "",
        dealer:         serviceData.dealer         || "",
        drawer:         serviceData.drawer         || "",
        serviceRep:     serviceData.serviceRep     || "",
        serviceCharge:  Number(serviceData.serviceCharge  || 0),
        spareCharge:    Number(serviceData.spareCharge    || 0),
        // ✅ FIX — spareBaseline (snapshotted by the /rebill route) MUST be carried
        // through every normal Update too. This object lists every service.* field
        // explicitly, so any field left out here gets silently wiped to undefined
        // on the next Update — which would erase the rebill-cycle spare baseline
        // and bring back the wrong Service Charge auto-calc bug.
        spareBaseline:  Number(serviceData.spareBaseline  || 0),
        // ✅ FIX — rawSpareBaseline was missing from this explicit list entirely, so
        // every normal Update silently wiped the rebill-cycle Raw Spare baseline
        // back to undefined → 0, making the Raw Spare field show its FULL lifetime
        // total again the moment anyone hit Update after a rebill.
        rawSpareBaseline: Number(serviceData.rawSpareBaseline || 0),
        income:         Number(serviceData.income  || 0),
        incomeDate:     serviceData.incomeDate     || null,
        balance:        Number(serviceData.balance || 0),
        balanceDate:    serviceData.balanceDate    || null,
        othersAmount:   Number(serviceData.othersAmount || 0),
        othersItems:    serviceData.othersItems || [],
        paymentMode:    serviceData.paymentMode    || "",
        repairDate:     serviceData.repairDate     || null,
        deliveryDate:   serviceData.deliveryDate   || null,
        advanceAmount:  Number(serviceData.advanceAmount  || 0),
        // ✅ FIX — advanceDate was missing from this explicit list entirely, so it
        // was silently wiped to undefined on every normal Update.
        advanceDate:    serviceData.advanceDate    || null,
           advanceBaseline: Number(serviceData.advanceBaseline || 0),  
                 othersBaseline: Number(serviceData.othersBaseline || 0),   
        advanceItems:   advanceItems,
        margin:         Number(serviceData.margin  || 0),
        instaFollowers: serviceData.instaFollowers || "",
        googleReview:   serviceData.googleReview   || "",
        remarks:        serviceData.remarks        || "",
        revenueEntries: newRevenueEntries,
      },
    };

      if (req.file) {
      updateData.idProofImage = { url: req.file.path, public_id: req.file.filename };
    }

    // ✅ FIX — plain fields (jobSheetNo, customer, service...) மற்றும் $push
    // operator ஒரே update object-ல கலந்திருந்தா, MongoDB/Mongoose reliable-ஆ
    // handle பண்ணாது — $push silently drop ஆகிடும் (rebillPending மட்டும்
    // false ஆகும், rebillHistory எப்பவும் காலியா இருக்கும், error காட்டாம).
    // Everything-ஐயும் explicit-ஆ $set/$push-ஆ பிரிச்சு தர்றது.
    // ✅ FIX — rebillHistory is now correctly snapshotted at REBILL TIME (see the
    // /rebill route in routes/jobSheetRoutes.js), which captures the OLD invoice
    // before it gets zeroed out. This save ("Save Rebill" / normal Update) only
    // needs to clear the rebillPending flag — pushing another entry here would
    // reuse the NEWLY typed-in charges and wrongly mislabel them as "before rebill"
    // (that was the original bug).
    const mongoUpdate = { $set: updateData };
    if (job.rebillPending) {
      mongoUpdate.$set.rebillPending = false;
    }

    await JobSheet.findByIdAndUpdate(
      req.params.id,
      mongoUpdate,
      { new: true }
    );

    // ✅ Fresh fetch — DB-லிருந்து latest data எடு
    const freshJob = await JobSheet.findById(req.params.id);

    // ✅ WhatsApp status message ONLY when Device Status actually changed. Fire-and-forget:
    // never blocks the response and never fails the update if WhatsApp errors.
    const newMobileStatus = freshJob.device?.mobileStatus || "";
    if (newMobileStatus && newMobileStatus !== oldMobileStatus && freshJob.customer?.contact) {
      sendJobStatusWhatsApp(
        freshJob.customer.contact,
        freshJob.customer.name,
        freshJob.jobSheetNo,
        newMobileStatus
      );
    }

    res.json({ message: "Job Sheet Updated ✅", job: freshJob });

  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(400).json({ error: err.message });
  }
};


/* ================= SEND ESTIMATE EMAIL ================= */
exports.sendEstimateEmail = async (req, res) => {

  try {

    const job = await JobSheet.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        message: "Job not found"
      });
    }

    if (!job.customer?.email) {
      return res.status(400).json({
        message: "Customer email not available"
      });
    }

    /* GENERATE PDF */

    const pdfBuffer = await generatePDF(job);

    const total =
      Number(job.service?.serviceCharge || 0) +
      Number(job.service?.spareCharge || 0);

    const subject = `Estimate - ${job.jobSheetNo}`;

    const text = `
Dear ${job.customer.name},

Here is your service estimate.

Estimate No: ${job.jobSheetNo}
Estimated Amount: ₹${total}

Thank you for choosing Radnus Communication.
`;

    /* SEND EMAIL */

    await sendEmail(
      job.customer.email,
      subject,
      text,
      pdfBuffer,
      `Estimate-${job.jobSheetNo}.pdf`
    );

    res.json({
      message: "Estimate email sent successfully"
    });

  } catch (error) {

    console.error("SEND ESTIMATE ERROR:", error);

    res.status(500).json({
      message: error.message
    });

  }

};


/* ================= USER REPORT (grouped by Service Rep) ================= */
// ✅ Groups by "service.serviceRep" (not createdBy.username) so it stays consistent
// with the Salesrep Report — e.g. a login username that differs from the assigned
// Service Rep name won't cause a mismatch.
exports.getUserReport = async (req, res) => {
  try {
    const { jobSheetNo, fromDate, toDate } = req.query;

    const query = {};

    if (jobSheetNo && jobSheetNo.trim()) {
      const q = jobSheetNo.trim();
      query.$or = [
        { "service.serviceRep": { $regex: q, $options: "i" } },
        { jobSheetNo:           { $regex: q, $options: "i" } },
      ];
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
    console.error("USER REPORT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};