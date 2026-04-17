const { config } = require('../config');
const logger = require('../utils/logger');

class GridStrategy {
  constructor(client) {
    this.client = client;
    this.symbol = config.trading.symbol;
    this.upperPrice = config.grid.upperPrice;
    this.lowerPrice = config.grid.lowerPrice;
    this.levels = config.grid.levels;
    this.orderAmount = config.grid.orderAmount;
    this.gridLines = [];
    this.activeOrders = new Map(); // price -> orderId
    this.running = false;
  }

  _buildGrid() {
    const step = (this.upperPrice - this.lowerPrice) / this.levels;
    this.gridLines = [];
    for (let i = 0; i <= this.levels; i++) {
      this.gridLines.push(
        parseFloat((this.lowerPrice + step * i).toFixed(2))
      );
    }
    logger.info(
      `Grid built: ${this.levels} levels from ${this.lowerPrice} to ${this.upperPrice} ` +
      `(step: ${step.toFixed(2)})`
    );
  }

  async start() {
    logger.info(`Starting Grid strategy on ${this.symbol}`);
    this._buildGrid();
    const currentPrice = await this.client.getPrice(this.symbol);
    logger.info(`Current price: ${currentPrice}`);

    if (currentPrice < this.lowerPrice || currentPrice > this.upperPrice) {
      throw new Error(
        `Current price ${currentPrice} is outside grid range [${this.lowerPrice}, ${this.upperPrice}]`
      );
    }

    await this._placeInitialOrders(currentPrice);
    this.running = true;
  }

  async _placeInitialOrders(currentPrice) {
    const openOrders = await this.client.getOpenOrders(this.symbol);
    if (openOrders.length > 0) {
      logger.warn(`Found ${openOrders.length} existing open orders, canceling...`);
      await this.client.cancelAllOrders(this.symbol);
    }

    for (const price of this.gridLines) {
      const side = price < currentPrice ? 'BUY' : 'SELL';
      if (price === currentPrice) continue;

      try {
        const order = await this.client.placeOrder({
          symbol: this.symbol,
          side,
          type: 'LIMIT',
          price: price.toFixed(2),
          quantity: this.orderAmount,
        });
        this.activeOrders.set(price, order.orderId);
        logger.debug(`Placed ${side} order at ${price} -> ${order.orderId}`);
      } catch (err) {
        logger.error(`Failed to place order at ${price}: ${err.message}`);
      }
    }

    logger.info(`Grid initialized with ${this.activeOrders.size} orders`);
  }

  // Called when an order fill is detected (via WebSocket or polling)
  async onOrderFilled(filledPrice, filledSide) {
    if (!this.running) return;

    logger.info(`Order filled: ${filledSide} @ ${filledPrice}`);
    this.activeOrders.delete(filledPrice);

    // Place opposite order at the adjacent grid level
    const step = (this.upperPrice - this.lowerPrice) / this.levels;
    let counterPrice;

    if (filledSide === 'BUY') {
      // Buy filled -> place sell one level above
      counterPrice = parseFloat((filledPrice + step).toFixed(2));
      if (counterPrice <= this.upperPrice) {
        await this._placeGridOrder('SELL', counterPrice);
      }
    } else {
      // Sell filled -> place buy one level below
      counterPrice = parseFloat((filledPrice - step).toFixed(2));
      if (counterPrice >= this.lowerPrice) {
        await this._placeGridOrder('BUY', counterPrice);
      }
    }
  }

  async _placeGridOrder(side, price) {
    if (this.activeOrders.has(price)) return;

    try {
      const order = await this.client.placeOrder({
        symbol: this.symbol,
        side,
        type: 'LIMIT',
        price: price.toFixed(2),
        quantity: this.orderAmount,
      });
      this.activeOrders.set(price, order.orderId);
      logger.info(`Grid refill: placed ${side} @ ${price} -> ${order.orderId}`);
    } catch (err) {
      logger.error(`Grid refill failed at ${price}: ${err.message}`);
    }
  }

  async checkFilledOrders() {
    if (!this.running) return;

    try {
      const openOrders = await this.client.getOpenOrders(this.symbol);
      const openOrderIds = new Set(openOrders.map((o) => o.orderId));

      for (const [price, orderId] of this.activeOrders.entries()) {
        if (!openOrderIds.has(orderId) && !orderId.startsWith('DRY-')) {
          const side = price < (await this.client.getPrice(this.symbol)) ? 'BUY' : 'SELL';
          await this.onOrderFilled(price, side);
        }
      }
    } catch (err) {
      logger.error(`Error checking filled orders: ${err.message}`);
    }
  }

  async stop() {
    logger.info('Stopping Grid strategy...');
    this.running = false;
    await this.client.cancelAllOrders(this.symbol);
    this.activeOrders.clear();
  }

  getStatus() {
    return {
      running: this.running,
      symbol: this.symbol,
      gridRange: `${this.lowerPrice} - ${this.upperPrice}`,
      levels: this.levels,
      activeOrders: this.activeOrders.size,
    };
  }
}

module.exports = GridStrategy;
