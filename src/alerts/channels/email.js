const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

class EmailChannel {
  constructor({ host, port, user, pass, from, to }) {
    this.to = to;
    this.from = from || user;
    this.enabled = Boolean(host && user && pass && to);

    if (this.enabled) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(port || '587', 10),
        secure: parseInt(port || '587', 10) === 465,
        auth: { user, pass },
      });
    }
  }

  async send(subject, body) {
    if (!this.enabled) return;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: this.to,
        subject,
        text: body,
        html: `<pre style="font-family:monospace">${body}</pre>`,
      });
    } catch (err) {
      logger.error(`Email alert failed: ${err.message}`);
    }
  }
}

module.exports = EmailChannel;
