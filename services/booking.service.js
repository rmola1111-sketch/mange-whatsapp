const db = require("../db/db");

const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;

function createBooking(businessId, phone, time) {
    return new Promise((resolve) => {
        const [hour] = time.split(":").map(Number);
        
        if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) {
            return resolve({ 
                success: false, 
                error: "closed", 
                message: `❌ אנחנו סגורים ב-${time}. השעות שלנו: 0${OPEN_HOUR}:00-${CLOSE_HOUR}:00.` 
            });
        }

        const query = `INSERT INTO bookings (business_id, customer_phone, time) VALUES (?, ?, ?)`;
        db.run(query, [businessId, phone, time], function (err) {
            if (err) {
                if (err.message.includes("UNIQUE")) return resolve({ success: false, error: "exists" });
                return resolve({ success: false, error: "db_error" });
            }
            resolve({ success: true });
        });
    });
}

function cancelBooking(businessId, phone) {
    return new Promise(resolve => {
        db.run("DELETE FROM bookings WHERE business_id=? AND customer_phone=?", [businessId, phone], () => resolve(true));
    });
}

module.exports = { createBooking, cancelBooking };
