const express = require("express");
const router = express.Router();
const db = require("../db/db");

// יצירת לוג
router.post("/", (req, res) => {
  const { message, type } = req.body;

  db.run(
    "INSERT INTO logs (message, type) VALUES (?, ?)",
    [message, type],
    () => res.json({ success: true })
  );
});

// שליפת לוגים
router.get("/", (req, res) => {
  db.all("SELECT * FROM logs ORDER BY id DESC LIMIT 50", [], (err, rows) => {
    res.json(rows);
  });
});

module.exports = router;