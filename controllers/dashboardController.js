const JobSheet = require("../models/JobSheet");

exports.getDashboardStats = async (req, res) => {
  try {
    // 🔢 Total Jobs
    const totalJobs = await JobSheet.countDocuments();

    // ✅ Completed (Invoice Generated)
    const completedJobs = await JobSheet.countDocuments({
      isInvoiced: true
    });

    // ⏳ Pending Jobs
    // Repaired / Delivered jobs pending count-la varakoodadhu
    const pendingJobs = await JobSheet.countDocuments({
      isInvoiced: false,
      "device.mobileStatus": {
        $nin: ["Repaired", "Delivered", "Delivered NR/NA"]
      }
    });

    // 📦 Received Jobs
    const receivedJobs = await JobSheet.countDocuments({
      "device.mobileStatus": "Received"
    });

    // 🔧 Repaired Jobs (Optional Card)
    const repairedJobs = await JobSheet.countDocuments({
      "device.mobileStatus": "Repaired"
    });

    // 📤 Response
    res.json({
      totalJobs,
      completedJobs,
      pendingJobs,
      receivedJobs,
      repairedJobs
    });

  } catch (err) {
    console.error("Dashboard error:", err);

    res.status(500).json({
      message: err.message
    });
  }
};