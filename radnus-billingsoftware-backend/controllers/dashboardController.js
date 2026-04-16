const JobSheet = require("../models/JobSheet");

exports.getDashboardStats = async (req, res) => {
  try {
    // 🔢 Total Jobs
    const totalJobs = await JobSheet.countDocuments();

    // ✅ Completed (Invoice done)
    const completedJobs = await JobSheet.countDocuments({
      isInvoiced: true
    });

    // ⏳ Pending (Not invoiced)
    const pendingJobs = await JobSheet.countDocuments({
      isInvoiced: false
    });

    // 📦 Optional: Received (if needed later)
    const receivedJobs = await JobSheet.countDocuments({
      "device.mobileStatus": "Received"
    });

    // 📤 Response
    res.json({
      totalJobs,
      completedJobs,
      pendingJobs,
      receivedJobs
    });

  } catch (err) {
    console.error("Dashboard error:", err);

    res.status(500).json({
      message: err.message
    });
  }
};