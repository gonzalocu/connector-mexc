const { validate } = require('./config');
const Bot = require('./bot');
const logger = require('./utils/logger');
const fs = require('fs');

// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

try {
  validate();
} catch (err) {
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}

const bot = new Bot();

bot.start().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
