const { config } = require('../config');
const logger = require('../utils/logger');

class MAStrategy {
  constructor(client, alerts = null) {
    this.client = client;
    this.alerts = alerts;
    this.symbol = config.trading.symbol;
    this.shortPeriod = config.ma.shortPeriod;
    this.longPeriod = config.ma.longPeriod;
    this.interval = config.ma.interval;
    this.orderAmount = config.ma.orderAmount;
    this.position = null; // 'long' | null
    this.entryPrice = null;
    this.lastSignal = null;
    this.running = false;
  }

  _sma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  async analyze() {
    const klines = await this.client.getKlines(
      this.symbol,
      this.interval,
      this.longPeriod + 5
    );

    const closes = klines.map((k) => parseFloat(k[4]));

    const shortMA = this._sma(closes, this.shortPeriod);
    const longMA = this._sma(closes, this.longPeriod);

    if (shortMA === null || longMA === null) {
      logger.warn('Not enough candle data for MA calculation');
      return null;
    }

    const signal = shortMA > longMA ? 'BUY' : 'SELL';
    const currentPrice = closes[closes.length - 1];

    logger.debug(
      `MA Analysis | Price: ${currentPrice} | ` +
      `MA${this.shortPeriod}: ${shortMA.toFixed(4)} | ` +
      `MA${this.longPeriod}: ${longMA.toFixed(4)} | ` +
      `Signal: ${signal}`
    );

    return { signal, shortMA, longMA, currentPrice };
  }

  async run() {
    if (!this.running) return;

    try {
      const result = await this.analyze();
      if (!result) return;

      const { signal, currentPrice } = result;

      // Only act on signal changes (crossovers)
      if (signal === this.lastSignal) return;

      if (signal === 'BUY' && this.position !== 'long') {
        logger.info(`MA Crossover UP detected @ ${currentPrice} - Opening LONG`);
        if (this.alerts) await this.alerts.signal({ side: 'BUY', price: currentPrice, indicator: `MA${this.shortPeriod}/${this.longPeriod}`, value: 'crossover UP' });
        await this.client.placeOrder({
          symbol: this.symbol,
          side: 'BUY',
          type: 'MARKET',
          quantity: this.orderAmount,
        });
        this.position = 'long';
        this.entryPrice = currentPrice;
        if (this.alerts) await this.alerts.positionOpen({ price: currentPrice });

      } else if (signal === 'SELL' && this.position === 'long') {
        logger.info(`MA Crossover DOWN detected @ ${currentPrice} - Closing LONG`);
        if (this.alerts) await this.alerts.signal({ side: 'SELL', price: currentPrice, indicator: `MA${this.shortPeriod}/${this.longPeriod}`, value: 'crossover DOWN' });
        await this.client.placeOrder({
          symbol: this.symbol,
          side: 'SELL',
          type: 'MARKET',
          quantity: this.orderAmount,
        });
        const pnlPct = this.entryPrice
          ? ((currentPrice - this.entryPrice) / this.entryPrice * 100).toFixed(3)
          : 'n/a';
        if (this.alerts) await this.alerts.positionClose({ price: currentPrice, pnlPct });
        this.position = null;
        this.entryPrice = null;
      }

      this.lastSignal = signal;

    } catch (err) {
      logger.error(`MA strategy error: ${err.message}`);
      if (this.alerts) await this.alerts.error(`MA strategy error: ${err.message}`);
    }
  }

  start() {
    logger.info(
      `Starting MA strategy on ${this.symbol} | ` +
      `MA${this.shortPeriod}/${this.longPeriod} | Interval: ${this.interval}`
    );
    this.running = true;
  }

  stop() {
    logger.info('Stopping MA strategy...');
    this.running = false;
  }

  getStatus() {
    return {
      running: this.running,
      symbol: this.symbol,
      shortPeriod: this.shortPeriod,
      longPeriod: this.longPeriod,
      interval: this.interval,
      position: this.position,
      lastSignal: this.lastSignal,
    };
  }
}

module.exports = MAStrategy;
