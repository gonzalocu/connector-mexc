const { config } = require('../config');
const { rsi, vwap, filterTodayKlines } = require('../utils/indicators');
const logger = require('../utils/logger');

/**
 * VWAP + RSI mean-reversion strategy.
 *
 * Entry (BUY):
 *   RSI crosses back above oversold level (e.g. 30) from below
 *   AND current price is within vwapTolerance % of VWAP (near fair value)
 *
 * Exit (SELL):
 *   RSI rises above overbought level (e.g. 70)
 *   OR price closes above VWAP by more than vwapTolerance (profit target)
 *   OR RSI drops below exitRsi while in position (trailing stop)
 *
 * Momentum mode (VWAP_RSI_MODE=momentum):
 *   BUY  when price > VWAP AND RSI > 50 and rising
 *   SELL when price < VWAP OR RSI < 50
 */
class VwapRsiStrategy {
  constructor(client) {
    this.client = client;
    this.symbol = config.trading.symbol;
    this.interval = config.vwapRsi.interval;
    this.rsiPeriod = config.vwapRsi.rsiPeriod;
    this.rsiOversold = config.vwapRsi.rsiOversold;
    this.rsiOverbought = config.vwapRsi.rsiOverbought;
    this.vwapTolerance = config.vwapRsi.vwapTolerance;
    this.orderAmount = config.vwapRsi.orderAmount;
    this.mode = config.vwapRsi.mode; // 'reversion' | 'momentum'

    this.position = null; // 'long' | null
    this.prevRsi = null;
    this.running = false;
  }

  async _fetchIndicators() {
    // Fetch enough candles for RSI seed + smoothing (period * 3 is safe)
    const limit = Math.max(this.rsiPeriod * 3 + 5, 100);
    const klines = await this.client.getKlines(this.symbol, this.interval, limit);

    const closes = klines.map((k) => parseFloat(k[4]));
    const currentRsi = rsi(closes, this.rsiPeriod);

    // VWAP uses only today's candles for intraday intervals; full set otherwise
    const vwapKlines =
      ['1m', '5m', '15m', '30m'].includes(this.interval)
        ? filterTodayKlines(klines)
        : klines;

    const currentVwap = vwap(vwapKlines);
    const currentPrice = closes[closes.length - 1];

    return { currentPrice, currentRsi, currentVwap };
  }

  _isNearVwap(price, vwapValue) {
    if (!vwapValue) return true; // if VWAP unavailable, skip filter
    const diff = Math.abs(price - vwapValue) / vwapValue;
    return diff <= this.vwapTolerance / 100;
  }

  async run() {
    if (!this.running) return;

    try {
      const { currentPrice, currentRsi, currentVwap } = await this._fetchIndicators();

      if (currentRsi === null || currentVwap === null) {
        logger.warn('Not enough data for VWAP/RSI calculation, skipping...');
        return;
      }

      logger.debug(
        `VWAP/RSI | Price: ${currentPrice} | RSI(${this.rsiPeriod}): ${currentRsi} | ` +
        `VWAP: ${currentVwap} | Position: ${this.position || 'none'}`
      );

      if (this.mode === 'momentum') {
        await this._runMomentum(currentPrice, currentRsi, currentVwap);
      } else {
        await this._runReversion(currentPrice, currentRsi, currentVwap);
      }

      this.prevRsi = currentRsi;

    } catch (err) {
      logger.error(`VWAP/RSI strategy error: ${err.message}`);
    }
  }

  async _runReversion(price, currentRsi, currentVwap) {
    if (!this.position) {
      // BUY: RSI crossing up from oversold AND price near/below VWAP
      const rsiCrossUp =
        this.prevRsi !== null &&
        this.prevRsi < this.rsiOversold &&
        currentRsi >= this.rsiOversold;

      const nearVwap = price <= currentVwap * (1 + this.vwapTolerance / 100);

      if (rsiCrossUp && nearVwap) {
        logger.info(
          `[REVERSION] BUY signal | RSI crossed up: ${this.prevRsi} → ${currentRsi} | ` +
          `Price: ${price} | VWAP: ${currentVwap}`
        );
        await this._openLong(price);
      }
    } else {
      // SELL: RSI overbought OR price significantly above VWAP
      const rsiOverbought = currentRsi >= this.rsiOverbought;
      const aboveVwap = price >= currentVwap * (1 + this.vwapTolerance / 100);

      if (rsiOverbought || aboveVwap) {
        const reason = rsiOverbought
          ? `RSI overbought (${currentRsi})`
          : `Price above VWAP+${this.vwapTolerance}% (${price} vs ${currentVwap})`;
        logger.info(`[REVERSION] SELL signal | ${reason}`);
        await this._closeLong(price);
      }
    }
  }

  async _runMomentum(price, currentRsi, currentVwap) {
    const priceAboveVwap = price > currentVwap;
    const rsiAbove50 = currentRsi > 50;
    const rsiRising = this.prevRsi !== null && currentRsi > this.prevRsi;

    if (!this.position) {
      // BUY: price above VWAP, RSI above 50 and rising (momentum up)
      if (priceAboveVwap && rsiAbove50 && rsiRising) {
        logger.info(
          `[MOMENTUM] BUY signal | Price: ${price} > VWAP: ${currentVwap} | ` +
          `RSI: ${this.prevRsi} → ${currentRsi}`
        );
        await this._openLong(price);
      }
    } else {
      // SELL: price drops below VWAP OR RSI drops below 50
      if (!priceAboveVwap || !rsiAbove50) {
        const reason = !priceAboveVwap
          ? `Price below VWAP (${price} < ${currentVwap})`
          : `RSI below 50 (${currentRsi})`;
        logger.info(`[MOMENTUM] SELL signal | ${reason}`);
        await this._closeLong(price);
      }
    }
  }

  async _openLong(price) {
    await this.client.placeOrder({
      symbol: this.symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: this.orderAmount,
    });
    this.position = 'long';
    this.entryPrice = price;
    logger.info(`Long opened @ ~${price}`);
  }

  async _closeLong(price) {
    await this.client.placeOrder({
      symbol: this.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: this.orderAmount,
    });
    const pnl = this.entryPrice
      ? ((price - this.entryPrice) / this.entryPrice * 100).toFixed(3)
      : 'n/a';
    logger.info(`Long closed @ ~${price} | PnL: ${pnl}%`);
    this.position = null;
    this.entryPrice = null;
  }

  start() {
    logger.info(
      `Starting VWAP+RSI strategy on ${this.symbol} | ` +
      `Mode: ${this.mode} | RSI(${this.rsiPeriod}) ` +
      `oversold=${this.rsiOversold} overbought=${this.rsiOverbought} | ` +
      `Interval: ${this.interval} | VWAP tolerance: ±${this.vwapTolerance}%`
    );
    this.running = true;
  }

  stop() {
    logger.info('Stopping VWAP+RSI strategy...');
    this.running = false;
  }

  getStatus() {
    return {
      running: this.running,
      symbol: this.symbol,
      mode: this.mode,
      interval: this.interval,
      rsiPeriod: this.rsiPeriod,
      position: this.position,
      entryPrice: this.entryPrice || null,
      lastRsi: this.prevRsi,
    };
  }
}

module.exports = VwapRsiStrategy;
