const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { format, startOfMonth } = require('date-fns');

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const dbPath = path.join(__dirname, '..', 'parking.db');
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS parking_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          username TEXT,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS monthly_totals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          username TEXT,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          total_duration_minutes INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, month, year)
        );

        CREATE INDEX IF NOT EXISTS idx_user_month_year ON parking_records(user_id, month, year);
        CREATE INDEX IF NOT EXISTS idx_monthly_totals ON monthly_totals(user_id, month, year);
      `;

      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database tables created/verified');
          resolve();
        }
      });
    });
  }

  async addParkingRecord(userId, username, startTime, endTime, durationMinutes) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO parking_records (user_id, username, start_time, end_time, duration_minutes, month, year)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [userId, username, startTime, endTime, durationMinutes, month, year], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    }).then((recordId) => {
      return this.updateMonthlyTotal(userId, username, month, year, durationMinutes).then(() => recordId);
    });
  }

  async updateMonthlyTotal(userId, username, month, year, additionalMinutes) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO monthly_totals (user_id, username, month, year, total_duration_minutes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, month, year) 
        DO UPDATE SET 
          total_duration_minutes = total_duration_minutes + ?,
          updated_at = CURRENT_TIMESTAMP
      `;

      this.db.run(sql, [userId, username, month, year, additionalMinutes, additionalMinutes], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getCurrentMonthTotal(userId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT total_duration_minutes 
        FROM monthly_totals 
        WHERE user_id = ? AND month = ? AND year = ?
      `;

      this.db.get(sql, [userId, month, year], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.total_duration_minutes : 0);
        }
      });
    });
  }

  async getMonthlyHistory(userId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT month, year, total_duration_minutes
        FROM monthly_totals
        WHERE user_id = ?
        ORDER BY year DESC, month DESC
        LIMIT 12
      `;

      this.db.all(sql, [userId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getRecentRecords(userId, limit = 5) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT start_time, end_time, duration_minutes, created_at
        FROM parking_records
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      this.db.all(sql, [userId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async resetCurrentMonth(userId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE monthly_totals
        SET total_duration_minutes = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND month = ? AND year = ?
      `;

      this.db.run(sql, [userId, month, year], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
      });
    }
  }
}

module.exports = Database;