const express = require("express");
const router  = express.Router();

const JobSheet = require("../models/JobSheet");
const upload   = require("../middleware/upload");

const generateInvoicePDF = require("../utils/generateInvoicePDF");
const sendEmail          = require("../utils/sendEmail");

const {
  sendEstimateEmail,
  updateJobSheet,
  getJobSheetById,
  getUserReport,
} = require("../controllers/jobSheetController");

const MAX_JOBS = 5;

router.get("/user-report", getUserReport);

/* =====================================================
   WORKLOAD API
===================================================== */
router.get("/workload", async (req, res) => {
  try {
    const activeJobs = await JobSheet.find({
     "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
      isInvoiced: { $ne: true },
    }).select("service.engineer assignedTo");

    const countMap = {};
    for (const job of activeJobs) {
      const eng = job.assignedTo || job.service?.engineer;
      if (eng) countMap[eng] = (countMap[eng] || 0) + 1;
    }

    res.json(Object.entries(countMap).map(([name, activeJobs]) => ({ name, activeJobs })));
  } catch (err) {
    console.error("WORKLOAD ERROR:", err);
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
    "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
      isInvoiced: { $ne: true }
    }).select("jobSheetNo customer device service statusLogs repairSteps createdAt assignedTo");

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
          assignedTo: job.assignedTo || job.service?.engineer || "-",
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
      query.$or = [
        { jobSheetNo:         { $regex: q, $options: "i" } },
        { "device.imei":      { $regex: q, $options: "i" } },
        { "customer.contact": { $regex: q, $options: "i" } },
        { "customer.name":    { $regex: q, $options: "i" } }
      ];
    }

    if (status) query["device.mobileStatus"] = status;
    if (dealer) query["service.dealer"] = { $regex: dealer, $options: "i" };

    if (engineer) {
      const engLower = engineer.trim().toLowerCase();
      const engineerCondition = [
        { $expr: { $eq: [{ $toLower: "$assignedTo" }, engLower] } },
        {
          $and: [
            { $or: [{ assignedTo: null }, { assignedTo: "" }, { assignedTo: { $exists: false } }] },
            { $expr: { $eq: [{ $toLower: "$service.engineer" }, engLower] } }
          ]
        }
      ];
      if (query.$or) {
        const textOr = query.$or;
        delete query.$or;
        query.$and = [{ $or: textOr }, { $or: engineerCondition }];
      } else {
        query.$or = engineerCondition;
      }
    }

    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) {
        const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (toDate) {
        const end = new Date(toDate); end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      } else {
        const end = new Date(fromDate); end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
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
   CREATE JOBSHEET — with workload check
===================================================== */
router.post("/", upload.single("idProofImage"), async (req, res) => {
  try {
    const serviceData  = JSON.parse(req.body.service || "{}");
    const engineerName = serviceData.engineer;

    if (engineerName) {
      const activeCount = await JobSheet.countDocuments({
        $or: [
          { assignedTo: engineerName },
          {
            $and: [
              { $or: [{ assignedTo: null }, { assignedTo: "" }, { assignedTo: { $exists: false } }] },
              { "service.engineer": engineerName }
            ]
          }
        ],
       "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
        isInvoiced: { $ne: true },
      });
      if (activeCount >= MAX_JOBS) {
        return res.status(400).json({
          message: `${engineerName} is at full capacity (${MAX_JOBS} active jobs). Please choose another engineer.`,
          code: "ENGINEER_FULL",
        });
      }
    }

    const newJob = new JobSheet({
      jobSheetNo:        req.body.jobSheetNo,
      customer:          JSON.parse(req.body.customer   || "{}"),
      device:            { ...JSON.parse(req.body.device || "{}"), idProofType: req.body.idProofType },
      service:           serviceData,
      physicalCondition: JSON.parse(req.body.physicalCondition || "[]"),
      accessories:       JSON.parse(req.body.accessories       || "[]"),
      visualIssues:      JSON.parse(req.body.visualIssues      || "[]"),
      spareItems:        JSON.parse(req.body.spareItems         || "[]"),
    createdBy: (() => {
  try { return JSON.parse(req.body.createdBy || "{}"); }
  catch { return { username: req.body.createdBy || "", role: "" }; }
})(),

      assignedTo:        engineerName || null,
      idProofImage: req.file ? { url: req.file.path, public_id: req.file.filename } : null,
    });
    await newJob.save();
    res.status(201).json(newJob);
  } catch (err) {
    console.error("CREATE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* =====================================================
   ✅ REBILL — Reopen an invoiced job for re-repair
   - isInvoiced = false (unlock)
   - Save old invoice details to rebillHistory
   - Reset charges, status back to Received
   - Keep all customer/device info intact
===================================================== */
router.put("/:id/rebill", async (req, res) => {
  try {
    const { rebilledBy } = req.body;
    const job = await JobSheet.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.isInvoiced) return res.status(400).json({ message: "Job is not invoiced yet" });

    await JobSheet.findByIdAndUpdate(req.params.id, {
      isInvoiced: false,
      rebillPending: true,           // ✅ flag — snapshot இன்னும் save ஆகல
      "device.mobileStatus": "Received",
      "service.serviceCharge": 0,
      "service.spareCharge": 0,
      "service.remarks": "",
      spareItems: [],
      $push: {
        statusLogs: {
          status: "Received",
          updatedBy: rebilledBy || "admin",
          timestamp: new Date(),
          note: "Rebill opened",
        },
      },
    });

    const updated = await JobSheet.findById(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error("REBILL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===============
======================================
   TRANSFER — with workload check
===================================================== */
router.patch("/:id/transfer", async (req, res) => {
  try {
    const { from, to, note } = req.body;
    if (!to) return res.status(400).json({ message: "Transfer target required" });

    // ✅ Reception-ஆனா workload check வேண்டாம்
    if (to !== "Reception") {
      const activeCount = await JobSheet.countDocuments({
        _id: { $ne: req.params.id },
        $or: [
          { assignedTo: to },
          {
            $and: [
              { $or: [{ assignedTo: null }, { assignedTo: "" }, { assignedTo: { $exists: false } }] },
              { "service.engineer": to }
            ]
          }
        ],
        "device.mobileStatus": { $nin: ["Delivered", "Delivered NR/NA", "Repaired"] },
        isInvoiced: { $ne: true },
      });
      if (activeCount >= MAX_JOBS) {
        return res.status(400).json({
          message: `${to} is at full capacity (${MAX_JOBS} jobs). Cannot transfer.`,
          code: "ENGINEER_FULL",
        });
      }
    }

    const job = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        $set: { assignedTo: to },
        $push: { transferLog: { from, to, note: note || "", transferredAt: new Date() } }
      },
      { new: true }
    );
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ message: err.message });
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
      { "device.mobileStatus": status, $push: { statusLogs: { status, updatedBy, timestamp: new Date() } } },
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

    // Group by serviceRep
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

    // ✅ Already "Delivered NR/NA" இருந்தா அதையே வை, இல்லன்னா "Delivered" set பண்ணு
    const currentStatus = job.device?.mobileStatus;
    const finalStatus =
      currentStatus === "Delivered NR/NA" ? "Delivered NR/NA" : "Delivered";

    const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        isInvoiced: true,
        "device.mobileStatus": finalStatus,
      },
      { new: true }
    );

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
   CUSTOMER AUTOCOMPLETE API (FIXED - Show All Names Separately)
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

    // Get all matching jobs with unique name+contact combinations
    const customers = await JobSheet.aggregate([
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      
      // Group by name + contact (unique combination)
      {
        $group: {
          _id: {
            name: "$customer.name",
            contact: "$customer.contact"
          },
          name: { $first: "$customer.name" },
          contact: { $first: "$customer.contact" },
          altContact: { $first: "$customer.altContact" },
          address: { $first: "$customer.address" },
          email: { $first: "$customer.email" },
          lastJobDate: { $first: "$createdAt" }
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
        isCancelled:            true,
        cancelRemarks:          cancelRemarks.trim(),
        cancelledBy:            cancelledBy || "admin",
        cancelledAt:            new Date(),
        "device.mobileStatus":  "Cancelled",
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
// ✅ இது கீழே இருக்கணும்
router.get("/:id", getJobSheetById);
router.put("/:id", upload.single("idProofImage"), updateJobSheet);

module.exports = router;


