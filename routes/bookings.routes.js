// 📁 backend/routes/bookings.routes.js

const express = require("express");
const router = express.Router();
const db = require("../db/db");

router.get("/", (req, res) => {
  db.all("SELECT * FROM bookings ORDER BY id DESC", [], (err, rows) => {
    res.json(rows);
  });
});

router.delete("/:id", (req, res) => {
  db.run("DELETE FROM bookings WHERE id=?", [req.params.id], () => {
    res.json({ success: true });
  });
});

module.exports = router;