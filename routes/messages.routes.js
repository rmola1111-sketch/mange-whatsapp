const express = require("express");
const router = express.Router();
const db = require("../db/db");

router.get("/", (req, res) => {
  db.all(
    "SELECT * FROM messages ORDER BY id DESC LIMIT 50",
    [],
    (_, rows) => res.json(rows)
  );
});

module.exports = router;