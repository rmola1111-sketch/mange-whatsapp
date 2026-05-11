const express = require("express");
const router = express.Router();

const { createBooking } = require("../services/booking");

// 📅 יצירת תור
router.post("/", async (req, res) => {
  try {
    const { business_id, customer_phone, time } = req.body;

    // בדיקות בסיסיות
    if (!business_id || !customer_phone || !time) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const result = await createBooking(business_id, customer_phone, time);

    // אם תפוס
    if (!result.success) {
      return res.json({
        message: "❌ התור תפוס, נסה שעה אחרת"
      });
    }

    // הצלחה
    res.json({
      message: "🎉 התור נקבע בהצלחה!"
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;