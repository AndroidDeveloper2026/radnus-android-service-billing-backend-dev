const JobSheet = require("../models/JobSheet");
const { scope } = require("../middleware/authMiddleware"); // ✅ multi-store

exports.getDashboardStats = async (req, res) => {
  try {
    const base = scope(req); // {} for admin/gm "all stores", else { storeId }

    // 🔢 Total Jobs
    const totalJobs = await JobSheet.countDocuments({ ...base });

    // ✅ Completed (Invoice Generated)
    const completedJobs = await JobSheet.countDocuments({
      ...base,
      isInvoiced: true
    });

    // ⏳ Pending Jobs
    // Repaired / Delivered jobs pending count-la varakoodadhu
    const pendingJobs = await JobSheet.countDocuments({
      ...base,
      isInvoiced: false,
      "device.mobileStatus": {
        $nin: ["Repaired", "Delivered", "Delivered NR/NA"]
      }
    });

 
    // 📦 Received Jobs
    const receivedJobs = await JobSheet.countDocuments({
      ...base,
      "device.mobileStatus": "Received"
    });

    // 🔧 Repaired Jobs (Optional Card)
    const repairedJobs = await JobSheet.countDocuments({
      ...base,
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