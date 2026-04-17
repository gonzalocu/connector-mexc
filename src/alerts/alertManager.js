const { config } = require('../config');
const TelegramChannel = require('./channels/telegram');
const DiscordChannel = require('./channels/discord');
const EmailChannel = require('./channels/email');
const WebhookChannel = require('./channels/webhook');
const logger = require('../utils/logger');

/**
 * Alert levels: info | success | warning | error
 *
 * Alert types emitted by the bot:
 *   BOT_START / BOT_STOP
 *   SIGNAL        { side, price, rsi, vwap }
 *   ORDER_PLACED  { side, type, price, quantity, orderId, dryRun }
 *   POSITION_OPEN { side, price }
 *   POSITION_CLOSE{ side, price, pnlPct }
 *   GRID_FILL     { side, price, orderId }
 *   ERROR         { message }
 *   PRICE_ALERT   { price, threshold, direction }
 */
class AlertManager {
  constructor() {
    const a = config.alerts;

    this.telegram = new TelegramChannel({
      botToken: a.telegram.botToken,
      chatId: a.telegram.chatId,
    });

    this.discord = new DiscordChannel({ webhookUrl: a.discord.webhookUrl });

    this.email = new EmailChannel({
      host: a.email.host,
      port: a.email.port,
      user: a.email.user,
      pass: a.email.pass,
      from: a.email.from,
      to: a.email.to,
    });

    this.webhook = new WebhookChannel({
      url: a.webhook.url,
      secret: a.webhook.secret,
    });

    this.symbol = config.trading.symbol;
    this.dryRun = config.trading.dryRun;
  }

  // ─── Core dispatcher ─────────────────────────────────────────────────────

  async _dispatch(type, message, level, extra = {}) {
    const tag = this.dryRun ? '[DRY] ' : '';
    const fullMsg = `${tag}[${this.symbol}] ${message}`;
    const payload = { type, level, symbol: this.symbol, message: fullMsg, ...extra, ts: new Date().toISOString() };

    logger.debug(`Alert dispatched: ${type} | ${fullMsg}`);

    await Promise.all([
      this.telegram.send(this._telegramFormat(type, fullMsg, level)),
      this.discord.send(this._discordFormat(type, fullMsg), level),
      this.email.send(`[MEXC Bot] ${type} — ${this.symbol}`, fullMsg),
      this.webhook.send(payload),
    ]);
  }

  _telegramFormat(type, message, level) {
    const icon = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '🚨' }[level] || 'ℹ️';
    return `${icon} <b>${type}</b>\n${message}`;
  }

  _discordFormat(type, message) {
    return `**${type}**\n${message}`;
  }

  // ─── Typed helpers ────────────────────────────────────────────────────────

  async botStart() {
    const strategy = config.trading.strategy;
    await this._dispatch(
      'BOT_START',
      `Bot started | Strategy: <b>${strategy}</b> | DryRun: ${this.dryRun}`,
      'info'
    );
  }

  async botStop() {
    await this._dispatch('BOT_STOP', 'Bot stopped gracefully.', 'warning');
  }

  async signal({ side, price, indicator, value }) {
    const level = side === 'BUY' ? 'success' : 'warning';
    await this._dispatch(
      'SIGNAL',
      `${side} signal @ <b>${price}</b> | ${indicator}: ${value}`,
      level,
      { side, price, indicator, value }
    );
  }

  async orderPlaced({ side, type, price, quantity, orderId, dryRun }) {
    const priceStr = price ? `@ ${price}` : '(MARKET)';
    await this._dispatch(
      'ORDER_PLACED',
      `${side} ${type} ${quantity} ${priceStr} | ID: ${orderId}${dryRun ? ' [DRY]' : ''}`,
      'info',
      { side, type, price, quantity, orderId }
    );
  }

  async positionOpen({ price }) {
    await this._dispatch(
      'POSITION_OPEN',
      `Long opened @ <b>${price}</b>`,
      'success',
      { price }
    );
  }

  async positionClose({ price, pnlPct }) {
    const level = parseFloat(pnlPct) >= 0 ? 'success' : 'warning';
    await this._dispatch(
      'POSITION_CLOSE',
      `Long closed @ <b>${price}</b> | PnL: <b>${pnlPct}%</b>`,
      level,
      { price, pnlPct }
    );
  }

  async gridFill({ side, price, orderId }) {
    await this._dispatch(
      'GRID_FILL',
      `Grid order filled: ${side} @ <b>${price}</b> | ID: ${orderId}`,
      'success',
      { side, price, orderId }
    );
  }

  async priceAlert({ price, threshold, direction }) {
    await this._dispatch(
      'PRICE_ALERT',
      `Price <b>${price}</b> crossed ${direction} threshold <b>${threshold}</b>`,
      'warning',
      { price, threshold, direction }
    );
  }

  async error(message) {
    await this._dispatch('ERROR', message, 'error', { message });
  }
}

module.exports = AlertManager;
