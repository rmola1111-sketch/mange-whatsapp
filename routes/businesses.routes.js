const express = require("express");
const router = express.Router();
const db = require("../db/db");
const { createClient, clients } = require("../whatsapp/whatsapp.manager");

// 1. GET ALL
router.get("/", (req, res) => {
    db.all("SELECT * FROM businesses", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. CREATE
router.post("/", (req, res) => {
    const { name, phone } = req.body;
    db.run(
        "INSERT INTO businesses (name, phone, is_active, connection_status) VALUES (?, ?, 1, 'disconnected')",
        [name, phone],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const biz = { id: this.lastID, name, phone, is_active: 1 };
            createClient(biz);
            res.json({ success: true, id: this.lastID });
        }
    );
});

// 3. 🔥 UPDATE (החלק שהיה חסר)
router.put("/:id", (req, res) => {
    const id = req.params.id;
    const { price, location, name, is_active } = req.body;

    // בניית השאילתה בצורה דינמית כדי לעדכן רק מה שנשלח
    db.run(
        `UPDATE businesses SET 
            price = COALESCE(?, price), 
            location = COALESCE(?, location),
            name = COALESCE(?, name),
            is_active = COALESCE(?, is_active)
         WHERE id = ?`,
        [price, location, name, is_active, id],
        function (err) {
            if (err) {
                console.error("UPDATE ERROR:", err);
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ error: "Business not found" });
            
            res.json({ success: true });
        }
    );
});

// 4. QR REFRESH
router.post("/:id/qr", async (req, res) => {
    const id = req.params.id;
    if (clients[id]) {
        try { await clients[id].destroy(); } catch (e) {}
        delete clients[id];
    }
    db.get("SELECT * FROM businesses WHERE id=?", [id], (err, business) => {
        if (business) createClient(business);
        res.json({ success: true });
    });
});

// 5. DELETE
router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    if (clients[id]) {
        try { await clients[id].destroy(); } catch (e) {}
        delete clients[id];
    }
    db.run("DELETE FROM businesses WHERE id=?", [id], () => {
        res.json({ success: true });
    });
});

module.exports = router;
