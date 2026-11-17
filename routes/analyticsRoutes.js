// routes/analyticsRoutes.js
const express = require("express");
const router  = express.Router();
const protect = require("../middleware/authMiddleware");
const { adminOnly } = require("../middleware/roleMiddleware");
const { getOverview } = require("../controllers/analyticsController");

// login + admin only
router.use(protect, adminOnly);

router.get("/overview", getOverview);

module.exports = router;