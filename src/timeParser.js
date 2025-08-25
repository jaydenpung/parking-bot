const { parse, differenceInMinutes, format } = require('date-fns');

class TimeParser {
  constructor() {
    this.timePatterns = [
      /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)?/g,
      /(\d{1,2})\.(\d{2})\s*(am|pm|AM|PM)?/g,
      /(\d{4})\s*(hrs?)?/g,
      /from\s+(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?\s*to\s*(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/gi,
      /start[:\s]+(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?.*end[:\s]+(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/gi,
      /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g,
      /(\d{1,2})[:.](\d{2})\s*(hrs?|hours?|hr)?\s*to\s*(\d{1,2})[:.](\d{2})\s*(hrs?|hours?|hr)?/gi
    ];
  }

  extractTimes(text) {
    const normalizedText = text.replace(/\s+/g, ' ').trim();
    const times = [];
    
    const timeRegex = /(\d{1,2})[:.](\d{2})(?:\s*(am|pm|AM|PM))?/g;
    let match;
    
    while ((match = timeRegex.exec(normalizedText)) !== null) {
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      const period = match[3] ? match[3].toLowerCase() : null;
      
      times.push({
        hour,
        minute,
        period,
        raw: match[0]
      });
    }
    
    const militaryTimeRegex = /\b(\d{4})\b/g;
    while ((match = militaryTimeRegex.exec(normalizedText)) !== null) {
      const timeStr = match[1];
      const hour = parseInt(timeStr.substring(0, 2));
      const minute = parseInt(timeStr.substring(2, 4));
      
      if (hour <= 23 && minute <= 59) {
        times.push({
          hour,
          minute,
          period: null,
          raw: match[0]
        });
      }
    }
    
    return times;
  }

  parseTimeRange(text) {
    const times = this.extractTimes(text);
    
    if (times.length < 2) {
      return null;
    }
    
    const startTime = this.normalizeTime(times[0]);
    const endTime = this.normalizeTime(times[1]);
    
    if (!startTime || !endTime) {
      return null;
    }
    
    if (endTime.totalMinutes < startTime.totalMinutes) {
      endTime.totalMinutes += 24 * 60;
    }
    
    const durationMinutes = endTime.totalMinutes - startTime.totalMinutes;
    
    return {
      startTime: this.formatTime(startTime),
      endTime: this.formatTime(endTime),
      durationMinutes,
      durationFormatted: this.formatDuration(durationMinutes)
    };
  }

  normalizeTime(timeObj) {
    let { hour, minute, period } = timeObj;
    
    if (hour > 24 || minute > 59) {
      return null;
    }
    
    if (period) {
      if (period === 'pm' && hour !== 12) {
        hour += 12;
      } else if (period === 'am' && hour === 12) {
        hour = 0;
      }
    } else {
      if (hour < 7 && hour !== 0) {
        hour += 12;
      }
    }
    
    return {
      hour: hour % 24,
      minute,
      totalMinutes: (hour % 24) * 60 + minute
    };
  }

  formatTime(timeObj) {
    const hour = timeObj.hour.toString().padStart(2, '0');
    const minute = timeObj.minute.toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }

  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (mins === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
  }

  tryMultiplePatterns(text) {
    const normalizedText = text.toLowerCase().replace(/\n/g, ' ');
    
    const patterns = [
      { regex: /from\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?\s*to\s*(\d{1,2}):?(\d{2})?\s*(am|pm)?/i, type: 'from_to' },
      { regex: /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/, type: 'dash' },
      { regex: /start[:\s]+(\d{1,2}):?(\d{2})?.*end[:\s]+(\d{1,2}):?(\d{2})?/i, type: 'start_end' },
      { regex: /(\d{4})\s*-\s*(\d{4})/, type: 'military' }
    ];
    
    for (const pattern of patterns) {
      const match = normalizedText.match(pattern.regex);
      if (match) {
        return this.parseTimeRange(match[0]);
      }
    }
    
    return this.parseTimeRange(text);
  }
}

module.exports = TimeParser;