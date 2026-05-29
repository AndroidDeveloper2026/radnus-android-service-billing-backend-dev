const express = require("express");
const router = express.Router();

const JobSheet = require("../models/JobSheet");
const upload = require("../middleware/upload");

const generateInvoicePDF = require("../utils/generateInvoicePDF");
const sendEmail = require("../utils/sendEmail");

const {
  sendEstimateEmail,
  updateJobSheet,
  getJobSheetById,
  getUserReport,
} = require("../controllers/jobSheetController");


/* =====================================================
   ✅ IMPORTANT: ALL SPECIFIC ROUTES MUST COME FIRST
   BEFORE ANY /:id ROUTES — otherwise Express will
   treat "filter", "next-number" etc. as an :id param
===================================================== */
router.get("/user-report", getUserReport);

/* =====================================================
   FILTER JOBSHEETS
===================================================== */
router.get("/filter", async (req, res) => {
  try {

    const { status, fromDate, toDate, q, engineer, dealer } = req.query;

    let query = {};

    if (q) {
      query.$or = [
        { jobSheetNo: { $regex: q, $options: "i" } },
        { "device.imei": { $regex: q, $options: "i" } },
        { "customer.contact": { $regex: q, $options: "i" } },
        { "customer.name": { $regex: q, $options: "i" } }
      ];
    }

    if (status) query["device.mobileStatus"] = status;
    if (engineer) query["service.engineer"] = engineer;

    if (dealer) {
      query["service.dealer"] = { $regex: dealer, $options: "i" };
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
  } else {
    // ✅ If only fromDate is given, limit to end of that same day
    const end = new Date(fromDate);
    end.setHours(23, 59, 59, 999);
    query.createdAt.$lte = end;
  }
}

    const data = await JobSheet
      .find(query)
      .sort({ createdAt: -1 });

    res.json(data);

  } catch (err) {

    console.error("FILTER ERROR:", err);

    res.status(500).json({
      message: err.message
    });

  }
});


/* =====================================================
   NEXT JOB NUMBER  ✅ MUST BE BEFORE /:id
===================================================== */
router.get("/next-number", async (req, res) => {
  try {

    const allJobs = await JobSheet.find().select("jobSheetNo");

    if (!allJobs.length) {
      return res.json({ next: "JS-001" });
    }

    const numbers = allJobs.map(job => {
      const num = parseInt(String(job.jobSheetNo).replace(/\D/g, ""));
      return isNaN(num) ? 0 : num;
    });

    const maxNumber = Math.max(...numbers);
    const nextNumber = maxNumber + 1;

    const formatted = `JS-${String(nextNumber).padStart(3, "0")}`;

    return res.json({ next: formatted });

  } catch (err) {
    console.error("NEXT NUMBER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});


/* =====================================================
   CREATE NEW JOBSHEET  ✅ POST — no conflict with /:id
===================================================== */
router.post("/", upload.single("idProofImage"), async (req, res) => {
  try {

    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const newJob = new JobSheet({

      jobSheetNo: req.body.jobSheetNo,

      customer: JSON.parse(req.body.customer || "{}"),
      device: {
        ...JSON.parse(req.body.device || "{}"),
        idProofType: req.body.idProofType
      },

      service: JSON.parse(req.body.service || "{}"),

      physicalCondition: JSON.parse(req.body.physicalCondition || "[]"),
      accessories: JSON.parse(req.body.accessories || "[]"),
      visualIssues: JSON.parse(req.body.visualIssues || "[]"),

      spareItems: JSON.parse(req.body.spareItems || "[]"),

      createdBy: JSON.parse(req.body.createdBy || "{}"),

      idProofImage: req.file
        ? {
          url: req.file.path,
          public_id: req.file.filename
        }
        : null

    });

    await newJob.save();

    res.status(201).json(newJob);

  } catch (err) {

    console.error("CREATE ERROR:", err);

    res.status(500).json({
      message: err.message
    });

  }
});


/* =====================================================
   SEND INVOICE EMAIL  ✅ SPECIFIC PATH — before /:id
===================================================== */
router.post("/send-invoice/:id", async (req, res) => {

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

    const pdfBuffer = await generateInvoicePDF(job);

    const total =
      Number(job.service?.serviceCharge || 0) +
      Number(job.service?.spareCharge || 0);

    const subject = `Invoice - ${job.jobSheetNo}`;

    const text = `
Dear ${job.customer.name},

Your device service has been completed.

Invoice No: ${job.jobSheetNo}
Total Amount: ₹${total}

Thank you for choosing Radnus Communication.
`;

    await sendEmail(
      job.customer.email,
      subject,
      text,
      pdfBuffer,
      `Invoice-${job.jobSheetNo}.pdf`
    );

    res.json({
      message: "Invoice sent successfully ✅"
    });

  } catch (err) {

    console.error("SEND INVOICE ERROR:", err);

    res.status(500).json({
      message: err.message
    });

  }

});


/* =====================================================
   SEND ESTIMATE EMAIL  ✅ SPECIFIC PATH — before /:id
===================================================== */
router.post("/send-estimate/:id", sendEstimateEmail);


/* =====================================================
   LOCK INVOICE  ✅ SPECIFIC PATH — before plain /:id
===================================================== */
router.put("/:id/invoice", async (req, res) => {

  try {

    const job = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        isInvoiced: true,
        "device.mobileStatus": "Delivered"
      },
      { new: true }
    );

    res.json(job);

  } catch (err) {

    console.error("LOCK ERROR:", err);

    res.status(500).json({
      message: "Error locking invoice"
    });

  }

});


/* =====================================================
   UPDATE SPARE ITEMS  ✅ SPECIFIC PATH — before plain /:id
===================================================== */
router.put("/:id/spares", async (req, res) => {

  try {

    const { spareItems } = req.body;

    const total = spareItems.reduce(
      (sum, item) => sum + item.amount,
      0
    );

    const updated = await JobSheet.findByIdAndUpdate(
      req.params.id,
      {
        spareItems,
        "service.spareCharge": total
      },
      { new: true }
    );

    res.json(updated);

  } catch (err) {

    res.status(500).json({
      error: err.message
    });

  }

});


/* =====================================================
   ⚠️  GENERIC /:id ROUTES — ALWAYS LAST
   These will match ANYTHING, so keep them at the bottom
===================================================== */
router.get("/:id", getJobSheetById);

// ✅ FIX — upload middleware சேர்க்கப்பட்டது, இல்லாம FormData parse ஆகாது
router.put("/:id", upload.single("idProofImage"), updateJobSheet);



module.exports = router;