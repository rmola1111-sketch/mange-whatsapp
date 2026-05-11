const express = require("express");
const router = express.Router();
const db = require("../db/db");

// תורים
router.get("/bookings/:id", (req, res) => {
  db.all(
    "SELECT * FROM bookings WHERE business_id = ? ORDER BY time",
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// toggle bot
router.post("/toggle/:id", (req, res) => {
  db.get("SELECT active FROM businesses WHERE id=?", [req.params.id], (err, row) => {
    const newStatus = row.active === 1 ? 0 : 1;

    db.run(
      "UPDATE businesses SET active=? WHERE id=?",
      [newStatus, req.params.id],
      () => {
        res.json({ active: newStatus === 1 });
      }
    );
  });
});

module.exports = router;