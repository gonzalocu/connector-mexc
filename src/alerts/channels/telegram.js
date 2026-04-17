const axios = require('axios');
const logger = require('../../utils/logger');

class TelegramChannel {
  constructor({ botToken, chatId }) {
    this.apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    this.chatId = chatId;
    this.enabled = Boolean(botToken && chatId);
  }

  async send(message) {
    if (!this.enabled) return;
    try {
      await axios.post(this.apiUrl, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      logger.error(`Telegram alert failed: ${err.message}`);
    }
  }
}

module.exports = TelegramChannel;
