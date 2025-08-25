const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');

class Utils {
  static formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (mins === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `${hours}h ${mins}m`;
    }
  }

  static formatDetailedDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (mins === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} and ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
  }

  static formatMonthName(month, year) {
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  static calculateDayNightSplit(startDateTime, endDateTime) {
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    
    let dayMinutes = 0;  // 8am to 12am (midnight)
    let nightMinutes = 0; // 12am to 8am
    
    let current = new Date(start);
    
    while (current < end) {
      const currentHour = current.getHours();
      const currentMinute = current.getMinutes();
      
      // Calculate minutes until next boundary or end time
      let nextBoundary = new Date(current);
      
      if (currentHour >= 8) {
        // Currently in day time (8am-12am)
        nextBoundary.setHours(24, 0, 0, 0); // Next midnight
      } else {
        // Currently in night time (12am-8am)
        nextBoundary.setHours(8, 0, 0, 0); // Next 8am
      }
      
      // Don't go past end time
      if (nextBoundary > end) {
        nextBoundary = new Date(end);
      }
      
      // Calculate minutes in this period
      const minutesInPeriod = Math.floor((nextBoundary - current) / (1000 * 60));
      
      if (currentHour >= 8) {
        dayMinutes += minutesInPeriod;
      } else {
        nightMinutes += minutesInPeriod;
      }
      
      current = nextBoundary;
    }
    
    return {
      dayMinutes,
      nightMinutes,
      totalMinutes: dayMinutes + nightMinutes
    };
  }

  static async downloadFile(url, filePath) {
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }

  static async cleanupFile(filePath) {
    try {
      await fsPromises.unlink(filePath);
      console.log('Cleaned up file:', filePath);
    } catch (error) {
      console.error('Error cleaning up file:', filePath, error);
    }
  }

  static generateUniqueFilename(extension) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}_${random}.${extension}`;
  }

  static async ensureDirectory(dirPath) {
    try {
      await fsPromises.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.error('Error creating directory:', dirPath, error);
        throw error;
      }
    }
  }

  static isValidTimeFormat(timeString) {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeString);
  }

  static sanitizeUsername(username) {
    if (!username) return 'unknown';
    return username.replace(/[^a-zA-Z0-9_]/g, '');
  }

  static truncateText(text, maxLength = 100) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Utils;