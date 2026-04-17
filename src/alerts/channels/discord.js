const axios = require('axios');
const logger = require('../../utils/logger');

// Color codes per alert level
const COLORS = { info: 0x3498db, success: 0x2ecc71, warning: 0xf39c12, error: 0xe74c3c };

class DiscordChannel {
  constructor({ webhookUrl }) {
    this.webhookUrl = webhookUrl;
    this.enabled = Boolean(webhookUrl);
  }

  async send(message, level = 'info') {
    if (!this.enabled) return;
    try {
      await axios.post(this.webhookUrl, {
        embeds: [
          {
            description: message,
            color: COLORS[level] || COLORS.info,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (err) {
      logger.error(`Discord alert failed: ${err.message}`);
    }
  }
}

module.exports = DiscordChannel;
