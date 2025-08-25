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
    this.bot.onText(/\/start/, this.handleHelp.bind(this));
    this.bot.onText(/\/history/, this.handleHistory.bind(this));
    this.bot.onText(/\/current/, this.handleCurrent.bind(this));
    this.bot.onText(/\/help/, this.handleHelp.bind(this));
    this.bot.onText(/\/reset/, this.handleReset.bind(this));
    this.bot.onText(/\/kaboom/, this.handleResetAll.bind(this));
    this.bot.on('photo', this.handlePhoto.bind(this));
    this.bot.on('document', this.handleDocument.bind(this));

    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error);
    });
  }



  async handleHistory(msg) {
    const chatId = msg.chat.id;

    try {
      const allRecords = await this.db.getAllRecordsGroupedByMonth(chatId);
      const monthlyTotals = await this.db.getMonthlyHistory(chatId);
      
      if (allRecords.length === 0) {
        await this.bot.sendMessage(chatId, '📊 No parking history found.');
        return;
      }

      let message = '📊 *Complete Parking History:*\n\n';
      
      // Group records by month/year
      const recordsByMonth = {};
      for (const record of allRecords) {
        const key = `${record.year}-${record.month}`;
        if (!recordsByMonth[key]) {
          recordsByMonth[key] = [];
        }
        recordsByMonth[key].push(record);
      }
      
      // Display each month
      for (const totals of monthlyTotals) {
        const monthName = Utils.formatMonthName(totals.month, totals.year);
        const dayHours = Math.floor((totals.total_day_minutes || 0) / 60);
        const nightHours = Math.floor((totals.total_night_minutes || 0) / 60);
        const key = `${totals.year}-${totals.month}`;
        
        message += `**${monthName}**\n`;
        message += `☀️ Day: ${dayHours}h / 80h | 🌙 Night: ${nightHours}h / 80h\n`;
        message += `Total: ${Utils.formatDetailedDuration(totals.total_duration_minutes)}\n\n`;
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting history:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving history.');
    }
  }

  async handleCurrent(msg) {
    const chatId = msg.chat.id;

    try {
      const currentRecords = await this.db.getCurrentMonthRecords(chatId);
      const currentTotal = await this.db.getCurrentMonthTotal(chatId);
      
      const now = new Date();
      const monthName = Utils.formatMonthName(now.getMonth() + 1, now.getFullYear());
      
      if (currentRecords.length === 0) {
        await this.bot.sendMessage(chatId, `📝 *${monthName}*\n\nNo parking sessions this month.`, { parse_mode: 'Markdown' });
        return;
      }

      let message = `📝 *${monthName} Parking Details*\n\n`;
      
      // Show detailed breakdown for each record
      for (const record of currentRecords) {
        const startDate = new Date(record.start_datetime);
        const endDate = new Date(record.end_datetime);
        
        const dateStr = startDate.toLocaleDateString();
        const startTimeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        const endTimeStr = endDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
        
        const dayMinutes = record.day_minutes || 0;
        const nightMinutes = record.night_minutes || 0;
        
        message += `🚗 *${record.car_plate}* - ${record.visitor_name || 'Unknown'}\n`;
        message += `📅 ${dateStr}\n`;
        message += `⏰ ${startTimeStr} → ${endTimeStr}\n`;
        message += `☀️ Day: ${Utils.formatDuration(dayMinutes)} | 🌙 Night: ${Utils.formatDuration(nightMinutes)}\n`;
        message += `─────────────\n`;
      }
      
      // Calculate hours and warnings
      const dayHours = Math.floor(currentTotal.day / 60);
      const dayMins = currentTotal.day % 60;
      const nightHours = Math.floor(currentTotal.night / 60);
      const nightMins = currentTotal.night % 60;
      const dayWarning = dayHours >= 80 ? ' ⚠️ *LIMIT*' : dayHours >= 70 ? ' ⚠️' : '';
      const nightWarning = nightHours >= 80 ? ' ⚠️ *LIMIT*' : nightHours >= 70 ? ' ⚠️' : '';
      
      message += `\n📊 *Monthly Total:*\n`;
      message += `☀️ Day: ${dayHours}h ${dayMins}m / 80h${dayWarning}\n`;
      message += `🌙 Night: ${nightHours}h ${nightMins}m / 80h${nightWarning}\n`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting current month records:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving current month data.');
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
/current - Current month's parking sessions and total
/history - Complete parking history by month
/reset - Reset current month (requires confirmation)
/kaboom - Delete ALL parking history (requires confirmation)
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

      if (currentTotal.total === 0) {
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

Current total: *${Utils.formatDetailedDuration(currentTotal.total)}*
☀️ Day: ${Math.floor(currentTotal.day / 60)}h
🌙 Night: ${Math.floor(currentTotal.night / 60)}h
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

  async handleResetAll(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      // Get total records count
      const allRecords = await this.db.getAllRecordsGroupedByMonth(chatId);
      const monthlyTotals = await this.db.getMonthlyHistory(chatId);

      if (allRecords.length === 0) {
        await this.bot.sendMessage(chatId, `🅿️ *Complete History*\n\nNo parking records to reset - your history is already empty.`, { parse_mode: 'Markdown' });
        return;
      }

      // Calculate total hours across all months
      let totalDayMinutes = 0;
      let totalNightMinutes = 0;
      for (const totals of monthlyTotals) {
        totalDayMinutes += totals.total_day_minutes || 0;
        totalNightMinutes += totals.total_night_minutes || 0;
      }

      // Create confirmation buttons
      const confirmationMessage = `
🚨 *COMPLETE RESET CONFIRMATION*

⚠️ **WARNING: This will delete ALL parking history!**

This will permanently delete:
• ALL parking records (${allRecords.length} total)
• ALL monthly totals (${monthlyTotals.length} months)
• Complete history across all months
• Cannot be undone

**Current total across all months:**
☀️ Day: ${Math.floor(totalDayMinutes / 60)}h
🌙 Night: ${Math.floor(totalNightMinutes / 60)}h

Are you absolutely sure?
      `;

      const options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ YES, DELETE ALL', callback_data: `confirm_resetall_${chatId}` },
              { text: '❌ Cancel', callback_data: `cancel_resetall_${chatId}` }
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

        if (data === `confirm_resetall_${chatId}`) {
          try {
            await this.db.resetAllHistory(chatId);
            await this.bot.editMessageText(
              `✅ *Complete Reset Done*\n\nAll parking history has been permanently deleted.\n\n• ${allRecords.length} records deleted\n• ${monthlyTotals.length} months cleared\n• All totals reset to 0`,
              {
                chat_id: callbackChatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'All history deleted.' });
          } catch (error) {
            console.error('Error resetting all history:', error);
            await this.bot.editMessageText(
              '❌ Error deleting history. Please try again.',
              {
                chat_id: callbackChatId,
                message_id: callbackQuery.message.message_id
              }
            );
            await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Reset failed.' });
          }
        } else if (data === `cancel_resetall_${chatId}`) {
          await this.bot.editMessageText(
            '✅ Reset cancelled. All history preserved.',
            {
              chat_id: callbackChatId,
              message_id: callbackQuery.message.message_id
            }
          );
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Reset cancelled.' });
        }
      });

    } catch (error) {
      console.error('Error in resetall handler:', error);
      await this.bot.sendMessage(chatId, '❌ Error initiating complete reset. Please try again.');
    }
  }

  async handlePhoto(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const mediaGroupId = msg.media_group_id;

    // If part of a media group, collect all photos first
    if (mediaGroupId) {
      if (!this.mediaGroups) {
        this.mediaGroups = new Map();
      }
      
      if (!this.mediaGroups.has(mediaGroupId)) {
        this.mediaGroups.set(mediaGroupId, {
          photos: [],
          chatId,
          userId,
          username,
          timer: null
        });
      }
      
      const group = this.mediaGroups.get(mediaGroupId);
      group.photos.push(msg);
      
      // Clear previous timer
      if (group.timer) {
        clearTimeout(group.timer);
      }
      
      // Set a timer to process all photos after 1 second of no new photos
      group.timer = setTimeout(() => {
        this.processMediaGroup(mediaGroupId);
      }, 1000);
      
      return;
    }

    // Single photo processing - check if user is already processing anything
    if (this.isProcessing.get(userId)) {
      await this.bot.sendMessage(chatId, '⏳ Still processing your previous image. Please wait...');
      return;
    }

    this.isProcessing.set(userId, true);
    
    try {
      const result = await this.processSinglePhoto(msg, chatId, userId, username);
      
      if (result.success) {
        await this.sendSuccessMessage(chatId, result);
      }
    } finally {
      this.isProcessing.set(userId, false);
    }
  }

  async processSinglePhoto(msg, chatId, userId, username, suppressMessages = false) {
    try {
      if (!suppressMessages) {
        await this.bot.sendMessage(chatId, '📸 Processing image...');
      }
      
      const photo = msg.photo[msg.photo.length - 1];
      const file = await this.bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      
      const filename = Utils.generateUniqueFilename('jpg');
      const filePath = path.join(__dirname, '..', 'downloads', filename);
      
      await Utils.downloadFile(fileUrl, filePath);
      
      if (!suppressMessages) {
        await this.bot.sendMessage(chatId, '🔍 Extracting text...');
      }
      
      const ocrResult = await this.ocr.processImage(filePath);
      
      if (!ocrResult.text || ocrResult.text.length < 5) {
        if (!suppressMessages) {
          await this.bot.sendMessage(chatId, '❌ Could not extract readable text from the image.');
        }
        await Utils.cleanupFile(filePath);
        return { success: false, error: 'No readable text' };
      }

      if (!suppressMessages) {
        await this.bot.sendMessage(chatId, '🤖 Analyzing...');
      }
      
      const timeData = await this.geminiParser.parseTimeRange(ocrResult.text);
      
      if (!timeData.success) {
        if (!suppressMessages) {
          const extractedText = Utils.truncateText(ocrResult.text, 200);
          const errorMsg = timeData.extractedText 
            ? `❌ ${timeData.error}\n\nTime-related text found: ${timeData.extractedText}\n\nFull extracted text:\n\`${extractedText}\``
            : `❌ ${timeData.error}\n\nExtracted text:\n\`${extractedText}\``;
          
          await this.bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' });
        }
        await Utils.cleanupFile(filePath);
        return { success: false, error: timeData.error };
      }

      // Check for duplicate entries
      const isDuplicate = await this.db.checkDuplicateRecord(chatId, timeData.carPlate, timeData.startDateTime);
      if (isDuplicate) {
        if (!suppressMessages) {
          const startDate = new Date(timeData.startDateTime);
          await this.bot.sendMessage(chatId, 
            `🚫 *Duplicate Entry*\n\n🚗 ${timeData.carPlate} - ${startDate.toLocaleDateString()}\nAlready recorded.`, 
            { parse_mode: 'Markdown' }
          );
        }
        await Utils.cleanupFile(filePath);
        return { success: false, error: 'Duplicate entry' };
      }

      // Calculate day/night split
      const dayNightSplit = Utils.calculateDayNightSplit(timeData.startDateTime, timeData.endDateTime);
      
      const recordId = await this.db.addParkingRecord(
        chatId,
        userId,
        username,
        timeData.visitorName,
        timeData.carPlate,
        timeData.startDateTime,
        timeData.endDateTime,
        timeData.durationMinutes,
        dayNightSplit.dayMinutes,
        dayNightSplit.nightMinutes
      );

      await Utils.cleanupFile(filePath);

      return {
        success: true,
        timeData,
        dayNightSplit,
        recordId
      };

    } catch (error) {
      console.error('Error processing photo:', error);
      return { success: false, error: error.message };
    }
  }

  async processMediaGroup(mediaGroupId) {
    const group = this.mediaGroups.get(mediaGroupId);
    if (!group) return;

    const { photos, chatId, userId, username } = group;
    this.mediaGroups.delete(mediaGroupId);

    if (this.isProcessing.get(userId)) {
      await this.bot.sendMessage(chatId, '⏳ Already processing. Please wait...');
      return;
    }

    this.isProcessing.set(userId, true);

    try {
      await this.bot.sendMessage(chatId, `📸 Processing ${photos.length} images...`);
      
      const results = [];
      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      for (let i = 0; i < photos.length; i++) {
        const result = await this.processSinglePhoto(photos[i], chatId, userId, username, true);
        results.push(result);
        
        if (result.success) {
          successCount++;
        } else if (result.error === 'Duplicate entry') {
          duplicateCount++;
        } else {
          errorCount++;
        }
      }

      // Send summary
      if (successCount > 0) {
        const currentTotal = await this.db.getCurrentMonthTotal(chatId);
        const dayHours = Math.floor(currentTotal.day / 60);
        const nightHours = Math.floor(currentTotal.night / 60);
        const dayWarning = dayHours >= 70 ? ' ⚠️' : '';
        const nightWarning = nightHours >= 70 ? ' ⚠️' : '';

        let summaryMessage = `✅ *Batch Processing Complete!*\n\n`;
        summaryMessage += `📊 Successfully processed: ${successCount}/${photos.length} images\n`;
        if (duplicateCount > 0) summaryMessage += `🚫 Duplicates skipped: ${duplicateCount}\n`;
        if (errorCount > 0) summaryMessage += `❌ Errors: ${errorCount}\n`;
        summaryMessage += `\n📊 *Updated Monthly Total:*\n`;
        summaryMessage += `☀️ Day: ${dayHours}h / 80h${dayWarning}\n`;
        summaryMessage += `🌙 Night: ${nightHours}h / 80h${nightWarning}`;

        await this.bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
      } else {
        await this.bot.sendMessage(chatId, `❌ Could not process any of the ${photos.length} images successfully.`);
      }

    } catch (error) {
      console.error('Error processing media group:', error);
      await this.bot.sendMessage(chatId, '❌ Error processing images.');
    } finally {
      this.isProcessing.set(userId, false);
    }
  }

  async sendSuccessMessage(chatId, result) {
    const currentTotal = await this.db.getCurrentMonthTotal(chatId);
    const { timeData, dayNightSplit } = result;
    
    const confidenceEmoji = timeData.confidence === 'high' ? '🎯' : timeData.confidence === 'medium' ? '✅' : '⚠️';
    const startDate = new Date(timeData.startDateTime);
    const endDate = new Date(timeData.endDateTime);
    
    const startDateStr = startDate.toLocaleDateString();
    const endDateStr = endDate.toLocaleDateString();
    const startTimeStr = startDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const endTimeStr = endDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    
    const dateDisplay = startDateStr === endDateStr ? startDateStr : `${startDateStr} - ${endDateStr}`;
    
    // Calculate limit warnings
    const dayHoursUsed = Math.floor(currentTotal.day / 60);
    const nightHoursUsed = Math.floor(currentTotal.night / 60);
    const dayWarning = dayHoursUsed >= 80 ? ' ⚠️ *LIMIT REACHED*' : dayHoursUsed >= 70 ? ' ⚠️' : '';
    const nightWarning = nightHoursUsed >= 80 ? ' ⚠️ *LIMIT REACHED*' : nightHoursUsed >= 70 ? ' ⚠️' : '';
    
    const successMessage = `
${confidenceEmoji} *Parking session recorded!*

👤 Visitor: ${timeData.visitorName}
🚗 Car Plate: ${timeData.carPlate}
📅 Date: ${dateDisplay}
🕐 Start: ${startTimeStr}
🕐 End: ${endTimeStr}
⏱️ Duration: ${timeData.durationFormatted}
  ☀️ Day: ${Utils.formatDuration(dayNightSplit.dayMinutes)}
  🌙 Night: ${Utils.formatDuration(dayNightSplit.nightMinutes)}

📊 *This month's total:*
☀️ Day: ${dayHoursUsed}h / 80h${dayWarning}
🌙 Night: ${nightHoursUsed}h / 80h${nightWarning}
    `;

    await this.bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
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