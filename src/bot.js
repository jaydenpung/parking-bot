require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const Database = require('./database');
const OCRProcessor = require('./ocr');
const GeminiParser = require('./geminiParser');
const Utils = require('./utils');

class ParkingBot {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.bot = new TelegramBot(this.token, { polling: true });
    this.db = new Database();
    this.ocr = new OCRProcessor();
    this.geminiParser = new GeminiParser();
    this.isProcessing = new Map();
  }

  async init() {
    try {
      await this.db.init();
      await this.ocr.init();
      await this.ocr.ensureDirectories();
      this.setupHandlers();
      console.log('Parking bot initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize bot:', error);
      process.exit(1);
    }
  }

  setupHandlers() {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/current/, this.handleCurrent.bind(this));
    this.bot.onText(/\/history/, this.handleHistory.bind(this));
    this.bot.onText(/\/recent/, this.handleRecent.bind(this));
    this.bot.onText(/\/help/, this.handleHelp.bind(this));
    this.bot.on('photo', this.handlePhoto.bind(this));
    this.bot.on('document', this.handleDocument.bind(this));

    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error);
    });
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const username = msg.from.username || 'User';

    const welcomeMessage = `
🚗 *Welcome to Parking Duration Tracker!*

I help you track your parking time by analyzing screenshots of parking tickets or meters.

*How to use:*
📸 Send me a screenshot of your parking ticket/meter
⏱️ I'll extract the start and end times
📊 Your parking duration will be added to this month's total

*Commands:*
/current - View this month's total parking time
/history - See previous months' totals
/recent - Show your last 5 parking sessions
/help - Show this help message

Just send me a photo to get started! 🎯
    `;

    await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  }

  async handleCurrent(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const currentTotal = await this.db.getCurrentMonthTotal(userId);
      const now = new Date();
      const monthName = Utils.formatMonthName(now.getMonth() + 1, now.getFullYear());
      
      const message = currentTotal > 0 
        ? `🅿️ *${monthName}*\nTotal parking time: *${Utils.formatDetailedDuration(currentTotal)}*`
        : `🅿️ *${monthName}*\nNo parking time recorded yet this month.`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting current month total:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving current month data.');
    }
  }

  async handleHistory(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const history = await this.db.getMonthlyHistory(userId);
      
      if (history.length === 0) {
        await this.bot.sendMessage(chatId, '📊 No parking history found.');
        return;
      }

      let message = '📊 *Parking History:*\n\n';
      
      for (const record of history) {
        const monthName = Utils.formatMonthName(record.month, record.year);
        const duration = Utils.formatDetailedDuration(record.total_duration_minutes);
        message += `• ${monthName}: ${duration}\n`;
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting history:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving history.');
    }
  }

  async handleRecent(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const recentRecords = await this.db.getRecentRecords(userId);
      
      if (recentRecords.length === 0) {
        await this.bot.sendMessage(chatId, '📝 No parking sessions found.');
        return;
      }

      let message = '📝 *Recent Parking Sessions:*\n\n';
      
      for (const record of recentRecords) {
        const date = new Date(record.created_at).toLocaleDateString();
        const duration = Utils.formatDuration(record.duration_minutes);
        message += `• ${date}: ${record.start_time} - ${record.end_time} (${duration})\n`;
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting recent records:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving recent sessions.');
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🚗 *Parking Duration Tracker Help*

*How it works:*
1. Take a screenshot of your parking ticket/meter
2. Send the image to me
3. I'll extract start and end times using OCR
4. Duration is calculated and added to your monthly total

*Supported formats:*
• Time ranges: "9:00 AM - 5:00 PM"
• Military time: "0900 - 1700"
• Text patterns: "From 9:00 to 17:00"

*Commands:*
/current - Current month's total
/history - Previous months' history
/recent - Last 5 parking sessions
/help - This help message

*Tips:*
• Clear, well-lit photos work best
• Make sure text is readable
• I'll let you know if I can't read the times

Need help? Just send me a photo! 📸
    `;

    await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }

  async handlePhoto(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;

    if (this.isProcessing.get(userId)) {
      await this.bot.sendMessage(chatId, '⏳ Still processing your previous image. Please wait...');
      return;
    }

    this.isProcessing.set(userId, true);

    try {
      await this.bot.sendMessage(chatId, '📸 Image received! Processing...');
      
      const photo = msg.photo[msg.photo.length - 1];
      const file = await this.bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      
      const filename = Utils.generateUniqueFilename('jpg');
      const filePath = path.join(__dirname, '..', 'downloads', filename);
      
      await Utils.downloadFile(fileUrl, filePath);
      await this.bot.sendMessage(chatId, '🔍 Extracting text from image...');
      
      const ocrResult = await this.ocr.processImage(filePath);
      
      if (!ocrResult.text || ocrResult.text.length < 5) {
        await this.bot.sendMessage(chatId, '❌ Could not extract readable text from the image. Please try a clearer photo.');
        await Utils.cleanupFile(filePath);
        return;
      }

      await this.bot.sendMessage(chatId, '🤖 Analyzing time information with AI...');
      
      const timeData = await this.geminiParser.parseTimeRange(ocrResult.text);
      
      if (!timeData.success) {
        const extractedText = Utils.truncateText(ocrResult.text, 200);
        const errorMsg = timeData.extractedText 
          ? `❌ ${timeData.error}\n\nTime-related text found: ${timeData.extractedText}\n\nFull extracted text:\n\`${extractedText}\``
          : `❌ ${timeData.error}\n\nExtracted text:\n\`${extractedText}\``;
        
        await this.bot.sendMessage(chatId, 
          errorMsg + '\n\nPlease ensure the image contains clear start and end times.', 
          { parse_mode: 'Markdown' }
        );
        await Utils.cleanupFile(filePath);
        return;
      }

      const recordId = await this.db.addParkingRecord(
        userId,
        username,
        timeData.startTime,
        timeData.endTime,
        timeData.durationMinutes
      );

      const currentTotal = await this.db.getCurrentMonthTotal(userId);
      
      const confidenceEmoji = timeData.confidence === 'high' ? '🎯' : timeData.confidence === 'medium' ? '✅' : '⚠️';
      const successMessage = `
${confidenceEmoji} *Parking session recorded!*

🕐 Start: ${timeData.startTime}
🕐 End: ${timeData.endTime}
⏱️ Duration: ${timeData.durationFormatted}
🤖 Confidence: ${timeData.confidence}

📊 This month's total: *${Utils.formatDetailedDuration(currentTotal)}*
      `;

      await this.bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
      await Utils.cleanupFile(filePath);

    } catch (error) {
      console.error('Error processing photo:', error);
      await this.bot.sendMessage(chatId, '❌ An error occurred while processing your image. Please try again.');
    } finally {
      this.isProcessing.set(userId, false);
    }
  }

  async handleDocument(msg) {
    const chatId = msg.chat.id;
    
    if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
      msg.photo = [{ file_id: msg.document.file_id }];
      await this.handlePhoto(msg);
    } else {
      await this.bot.sendMessage(chatId, '📸 Please send an image file for parking time extraction.');
    }
  }

  async stop() {
    console.log('Stopping bot...');
    await this.ocr.terminate();
    this.db.close();
    await this.bot.stopPolling();
  }
}

const bot = new ParkingBot();

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

bot.init().catch(console.error);

module.exports = ParkingBot;