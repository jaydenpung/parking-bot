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
    this.bot.onText(/\/reset/, this.handleReset.bind(this));
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
/reset - Reset current month (requires confirmation)
/help - Show this help message

Just send me a photo to get started! 🎯
    `;

    await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  }

  async handleCurrent(msg) {
    const chatId = msg.chat.id;

    try {
      const currentTotal = await this.db.getCurrentMonthTotal(chatId);
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

    try {
      const history = await this.db.getMonthlyHistory(chatId);
      
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

    try {
      const recentRecords = await this.db.getRecentRecords(chatId);
      
      if (recentRecords.length === 0) {
        await this.bot.sendMessage(chatId, '📝 No parking sessions found.');
        return;
      }

      let message = '📝 *Recent Parking Sessions:*\n\n';
      
      for (const record of recentRecords) {
        const duration = Utils.formatDuration(record.duration_minutes);
        const visitor = record.visitor_name ? `${record.visitor_name} - ` : '';
        
        const startDate = new Date(record.start_datetime);
        const endDate = new Date(record.end_datetime);
        
        const startDateStr = startDate.toLocaleDateString();
        const endDateStr = endDate.toLocaleDateString();
        const startTimeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        const endTimeStr = endDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        
        const dateDisplay = startDateStr === endDateStr ? startDateStr : `${startDateStr} - ${endDateStr}`;
        
        message += `• ${dateDisplay}: ${visitor}${record.car_plate}\n  ${startTimeStr} - ${endTimeStr} (${duration})\n`;
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
/reset - Reset current month (requires confirmation)
/help - This help message

*Tips:*
• Clear, well-lit photos work best
• Make sure text is readable
• I'll let you know if I can't read the times

Need help? Just send me a photo! 📸
    `;

    await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }

  async handleReset(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      // Get current month info
      const currentTotal = await this.db.getCurrentMonthTotal(chatId);
      const now = new Date();
      const monthName = Utils.formatMonthName(now.getMonth() + 1, now.getFullYear());

      if (currentTotal === 0) {
        await this.bot.sendMessage(chatId, `🅿️ *${monthName}*\n\nNo parking records to reset - your total is already 0.`, { parse_mode: 'Markdown' });
        return;
      }

      // Create confirmation buttons
      const confirmationMessage = `
🚨 *Reset Confirmation*

Are you sure you want to reset *${monthName}*?

This will:
• Delete ALL parking records for this month
• Reset monthly total to 0 minutes
• Cannot be undone

Current total: *${Utils.formatDetailedDuration(currentTotal)}*
      `;

      const options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Reset', callback_data: `confirm_reset_${chatId}` },
              { text: '❌ Cancel', callback_data: `cancel_reset_${chatId}` }
            ]
          ]
        }
      };

      await this.bot.sendMessage(chatId, confirmationMessage, options);

      // Handle callback responses
      this.bot.once('callback_query', async (callbackQuery) => {
        const data = callbackQuery.data;
        const callbackChatId = callbackQuery.message.chat.id;
        const callbackUserId = callbackQuery.from.id;

        // Only allow the same user who initiated the reset to confirm
        if (callbackUserId !== userId) {
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Only the user who initiated the reset can confirm.', show_alert: true });
          return;
        }

        if (data === `confirm_reset_${chatId}`) {
          try {
            await this.db.resetCurrentMonth(chatId);
            await this.bot.editMessageText(
              `✅ *Reset Complete*\n\n${monthName} parking records have been cleared.\n\nTotal reset to: *0 minutes*`,
              {
                chat_id: callbackChatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Reset completed successfully!' });
          } catch (error) {
            console.error('Error during reset:', error);
            await this.bot.editMessageText(
              '❌ *Reset Failed*\n\nAn error occurred while resetting. Please try again.',
              {
                chat_id: callbackChatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Reset failed!', show_alert: true });
          }
        } else if (data === `cancel_reset_${chatId}`) {
          await this.bot.editMessageText(
            '🅿️ *Reset Cancelled*\n\nYour parking records remain unchanged.',
            {
              chat_id: callbackChatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Reset cancelled.' });
        }
      });

    } catch (error) {
      console.error('Error in reset handler:', error);
      await this.bot.sendMessage(chatId, '❌ Error initiating reset. Please try again.');
    }
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

      // Check for duplicate entries
      const isDuplicate = await this.db.checkDuplicateRecord(chatId, timeData.carPlate, timeData.startDateTime);
      if (isDuplicate) {
        const startDate = new Date(timeData.startDateTime);
        await this.bot.sendMessage(chatId, 
          `🚫 *Duplicate Entry Detected*\n\nThis parking session already exists:\n🚗 Car: ${timeData.carPlate}\n📅 Date: ${startDate.toLocaleDateString()}\n🕐 Start: ${startDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}\n\nNo changes made to your total.`, 
          { parse_mode: 'Markdown' }
        );
        await Utils.cleanupFile(filePath);
        return;
      }

      const recordId = await this.db.addParkingRecord(
        chatId,
        userId,
        username,
        timeData.visitorName,
        timeData.carPlate,
        timeData.startDateTime,
        timeData.endDateTime,
        timeData.durationMinutes
      );

      const currentTotal = await this.db.getCurrentMonthTotal(chatId);
      
      const confidenceEmoji = timeData.confidence === 'high' ? '🎯' : timeData.confidence === 'medium' ? '✅' : '⚠️';
      const startDate = new Date(timeData.startDateTime);
      const endDate = new Date(timeData.endDateTime);
      
      const startDateStr = startDate.toLocaleDateString();
      const endDateStr = endDate.toLocaleDateString();
      const startTimeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      const endTimeStr = endDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      
      const dateDisplay = startDateStr === endDateStr ? startDateStr : `${startDateStr} - ${endDateStr}`;
      
      const successMessage = `
${confidenceEmoji} *Parking session recorded!*

👤 Visitor: ${timeData.visitorName}
🚗 Car Plate: ${timeData.carPlate}
📅 Date: ${dateDisplay}
🕐 Start: ${startTimeStr}
🕐 End: ${endTimeStr}
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