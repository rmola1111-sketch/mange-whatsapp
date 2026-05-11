const db = require("../db/db");

// יצירת עסק
function createBusiness(data) {
  return new Promise((resolve, reject) => {

    const {
      name,
      phone,
      start_hour,
      end_hour,
      slot_duration,
      price
    } = data;

    db.run(
      `INSERT INTO businesses 
      (name, phone, start_hour, end_hour, slot_duration, price) 
      VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone, start_hour, end_hour, slot_duration, price],
      function (err) {
        if (err) return reject(err);

        resolve({ id: this.lastID });
      }
    );
  });
}

// שליפת עסק
function getBusinessById(id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM businesses WHERE id = ?", [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

module.exports = { createBusiness, getBusinessById };