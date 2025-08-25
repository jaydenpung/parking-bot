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
          visitor_name TEXT,
          car_plate TEXT,
          start_datetime DATETIME NOT NULL,
          end_datetime DATETIME NOT NULL,
          duration_minutes INTEGER NOT NULL,
          day_minutes INTEGER DEFAULT 0,
          night_minutes INTEGER DEFAULT 0,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS monthly_totals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER NOT NULL,
          username TEXT,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          total_duration_minutes INTEGER DEFAULT 0,
          total_day_minutes INTEGER DEFAULT 0,
          total_night_minutes INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(chat_id, month, year)
        );
      `;

      this.db.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database tables created/verified');
          this.addNewColumns().then(resolve).catch(reject);
        }
      });
    });
  }

  async addNewColumns() {
    // Helper function to promisify db.run
    const runQuery = (sql, params = []) => {
      return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
          if (err) {
            if (err.message.includes('duplicate column name')) {
              resolve(); // Ignore duplicate column errors
            } else {
              reject(err);
            }
          } else {
            resolve();
          }
        });
      });
    };

    const execQuery = (sql) => {
      return new Promise((resolve, reject) => {
        this.db.exec(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    try {
      // Add all columns sequentially
      await runQuery('ALTER TABLE parking_records ADD COLUMN visitor_name TEXT');
      await runQuery('ALTER TABLE parking_records ADD COLUMN car_plate TEXT');
      await runQuery('ALTER TABLE parking_records ADD COLUMN chat_id INTEGER');
      await runQuery('ALTER TABLE monthly_totals ADD COLUMN chat_id INTEGER');
      await runQuery('ALTER TABLE parking_records ADD COLUMN start_datetime DATETIME');
      await runQuery('ALTER TABLE parking_records ADD COLUMN end_datetime DATETIME');
      await runQuery('ALTER TABLE parking_records ADD COLUMN day_minutes INTEGER DEFAULT 0');
      await runQuery('ALTER TABLE parking_records ADD COLUMN night_minutes INTEGER DEFAULT 0');
      await runQuery('ALTER TABLE monthly_totals ADD COLUMN total_day_minutes INTEGER DEFAULT 0');
      await runQuery('ALTER TABLE monthly_totals ADD COLUMN total_night_minutes INTEGER DEFAULT 0');

      // Create indexes
      const indexSql = `
        CREATE INDEX IF NOT EXISTS idx_chat_month_year ON parking_records(chat_id, month, year);
        CREATE INDEX IF NOT EXISTS idx_monthly_totals_chat ON monthly_totals(chat_id, month, year);
        CREATE INDEX IF NOT EXISTS idx_duplicate_check ON parking_records(chat_id, car_plate, start_datetime);
      `;
      
      await execQuery(indexSql);
      console.log('Database migration completed');
    } catch (error) {
      console.error('Error during database migration:', error);
      throw error;
    }
  }

  async addParkingRecord(chatId, userId, username, visitorName, carPlate, startDateTime, endDateTime, durationMinutes, dayMinutes, nightMinutes) {
    // Extract date components from start datetime for monthly tracking
    const startDate = new Date(startDateTime);
    const month = startDate.getMonth() + 1;
    const year = startDate.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO parking_records (chat_id, user_id, username, visitor_name, car_plate, start_datetime, end_datetime, duration_minutes, day_minutes, night_minutes, month, year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [chatId, userId, username, visitorName, carPlate, startDateTime, endDateTime, durationMinutes, dayMinutes, nightMinutes, month, year], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    }).then((recordId) => {
      return this.updateMonthlyTotal(chatId, username, month, year, dayMinutes, nightMinutes).then(() => recordId);
    });
  }

  async checkDuplicateRecord(chatId, carPlate, startDateTime) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT id FROM parking_records
        WHERE chat_id = ? AND car_plate = ? AND start_datetime = ?
        LIMIT 1
      `;

      this.db.get(sql, [chatId, carPlate, startDateTime], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row); // Returns true if duplicate exists
        }
      });
    });
  }

  async updateMonthlyTotal(chatId, username, month, year, dayMinutes, nightMinutes) {
    const totalMinutes = dayMinutes + nightMinutes;
    
    const updateQuery = (sql, params) => {
      return new Promise((resolve, reject) => {
        this.db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        });
      });
    };

    try {
      // First try to update existing record
      const changes = await updateQuery(
        `UPDATE monthly_totals SET 
         total_duration_minutes = total_duration_minutes + ?,
         total_day_minutes = total_day_minutes + ?,
         total_night_minutes = total_night_minutes + ?, 
         updated_at = CURRENT_TIMESTAMP 
         WHERE chat_id = ? AND month = ? AND year = ?`,
        [totalMinutes, dayMinutes, nightMinutes, chatId, month, year]
      );

      // If no rows were updated, insert new record
      if (changes === 0) {
        await updateQuery(
          `INSERT INTO monthly_totals (chat_id, username, month, year, total_duration_minutes, total_day_minutes, total_night_minutes) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [chatId, username, month, year, totalMinutes, dayMinutes, nightMinutes]
        );
      }
    } catch (error) {
      console.error('Error updating monthly total:', error);
      throw error;
    }
  }

  async getCurrentMonthTotal(chatId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT total_duration_minutes, total_day_minutes, total_night_minutes 
        FROM monthly_totals 
        WHERE chat_id = ? AND month = ? AND year = ?
      `;

      this.db.get(sql, [chatId, month, year], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? {
            total: row.total_duration_minutes || 0,
            day: row.total_day_minutes || 0,
            night: row.total_night_minutes || 0
          } : {
            total: 0,
            day: 0,
            night: 0
          });
        }
      });
    });
  }

  async getMonthlyHistory(chatId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT month, year, total_duration_minutes, total_day_minutes, total_night_minutes
        FROM monthly_totals
        WHERE chat_id = ?
        ORDER BY year DESC, month DESC
        LIMIT 12
      `;

      this.db.all(sql, [chatId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getCurrentMonthRecords(chatId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT visitor_name, car_plate, start_datetime, end_datetime, duration_minutes, day_minutes, night_minutes, created_at
        FROM parking_records
        WHERE chat_id = ? AND month = ? AND year = ?
        ORDER BY created_at DESC
      `;

      this.db.all(sql, [chatId, month, year], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getAllRecordsGroupedByMonth(chatId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT visitor_name, car_plate, start_datetime, end_datetime, duration_minutes, created_at, month, year
        FROM parking_records
        WHERE chat_id = ?
        ORDER BY year DESC, month DESC, created_at DESC
      `;

      this.db.all(sql, [chatId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async resetCurrentMonth(chatId) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    return new Promise((resolve, reject) => {
      // First delete all parking records for this month
      const deleteRecordsSql = `
        DELETE FROM parking_records
        WHERE chat_id = ? AND month = ? AND year = ?
      `;

      this.db.run(deleteRecordsSql, [chatId, month, year], (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Then reset/delete the monthly total
        const resetTotalSql = `
          DELETE FROM monthly_totals
          WHERE chat_id = ? AND month = ? AND year = ?
        `;

        this.db.run(resetTotalSql, [chatId, month, year], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
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