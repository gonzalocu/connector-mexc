const axios = require('axios');
const logger = require('../../utils/logger');

class WebhookChannel {
  constructor({ url, secret }) {
    this.url = url;
    this.secret = secret || '';
    this.enabled = Boolean(url);
  }

  async send(payload) {
    if (!this.enabled) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.secret) headers['X-Bot-Secret'] = this.secret;
      await axios.post(this.url, payload, { headers, timeout: 5000 });
    } catch (err) {
      logger.error(`Webhook alert failed: ${err.message}`);
    }
  }
}

module.exports = WebhookChannel;
