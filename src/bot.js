const { config } = require('./config');
const MexcClient = require('./mexcClient');
const MexcWebSocket = require('./mexcWebSocket');
const GridStrategy = require('./strategies/gridStrategy');
const MAStrategy = require('./strategies/maStrategy');
const VwapRsiStrategy = require('./strategies/vwapRsiStrategy');
const AlertManager = require('./alerts/alertManager');
const logger = require('./utils/logger');

const POLL_INTERVAL_MS = 60 * 1000;

class Bot {
  constructor() {
    this.client = new MexcClient();
    this.ws = new MexcWebSocket();
    this.alerts = new AlertManager();
    this.strategy = null;
    this.pollTimer = null;
    this.running = false;
  }

  async start() {
    logger.info('='.repeat(50));
    logger.info('MEXC Trading Bot starting...');
    logger.info(`Symbol   : ${config.trading.symbol}`);
    logger.info(`Strategy : ${config.trading.strategy}`);
    logger.info(`Dry Run  : ${config.trading.dryRun}`);
    logger.info('='.repeat(50));

    // Connect WebSocket for real-time price feed
    await this.ws.connect();
    this.ws.subscribeTicker(config.trading.symbol, (ticker) => {
      logger.debug(`Ticker: ${ticker.symbol} price=${ticker.price} change=${ticker.change}%`);
    });

    // Instantiate and start the selected strategy
    if (config.trading.strategy === 'grid') {
      this.strategy = new GridStrategy(this.client, this.alerts);
      await this.strategy.start();
      this._startGridPolling();
    } else if (config.trading.strategy === 'ma') {
      this.strategy = new MAStrategy(this.client, this.alerts);
      this.strategy.start();
      await this.strategy.run();
      this._startMAPolling();
    } else if (config.trading.strategy === 'vwap-rsi') {
      this.strategy = new VwapRsiStrategy(this.client, this.alerts);
      this.strategy.start();
      await this.strategy.run();
      this._startVwapRsiPolling();
    } else {
      throw new Error(`Unknown strategy: ${config.trading.strategy}`);
    }

    this.running = true;
    this._printStatus();
    await this.alerts.botStart();

    // Graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  _startGridPolling() {
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      await this.strategy.checkFilledOrders();
      this._printStatus();
    }, POLL_INTERVAL_MS);
  }

  _startMAPolling() {
    const intervalMs = this._intervalToMs(config.ma.interval);
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      await this.strategy.run();
      this._printStatus();
    }, intervalMs);
    logger.info(`MA polling every ${intervalMs / 1000}s`);
  }

  _startVwapRsiPolling() {
    const intervalMs = this._intervalToMs(config.vwapRsi.interval);
    this.pollTimer = setInterval(async () => {
      if (!this.running) return;
      await this.strategy.run();
      this._printStatus();
    }, intervalMs);
    logger.info(`VWAP+RSI polling every ${intervalMs / 1000}s`);
  }

  _intervalToMs(interval) {
    const map = { '1m': 60e3, '5m': 5*60e3, '15m': 15*60e3, '30m': 30*60e3,
                  '1h': 60*60e3, '4h': 4*60*60e3, '1d': 24*60*60e3 };
    return map[interval] || 60*60e3;
  }

  _printStatus() {
    if (!this.strategy) return;
    const status = this.strategy.getStatus();
    logger.info(`Status: ${JSON.stringify(status)}`);
  }

  async stop() {
    if (!this.running) return;
    logger.info('Shutting down bot...');
    this.running = false;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.strategy) await this.strategy.stop();
    this.ws.disconnect();
    await this.alerts.botStop();

    logger.info('Bot stopped.');
    process.exit(0);
  }
}

module.exports = Bot;
