const axios = require('axios');
const crypto = require('crypto');
const { config } = require('./config');
const logger = require('./utils/logger');

class MexcClient {
  constructor() {
    this.baseUrl = config.api.baseUrl;
    this.apiKey = config.api.key;
    this.secretKey = config.api.secret;
    this.dryRun = config.trading.dryRun;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: { 'X-MEXC-APIKEY': this.apiKey },
    });
  }

  _sign(params) {
    const query = Object.entries({ ...params, timestamp: Date.now() })
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(query)
      .digest('hex');
    return `${query}&signature=${signature}`;
  }

  async _get(path, params = {}, signed = false) {
    const query = signed ? this._sign(params) : new URLSearchParams(params).toString();
    const url = query ? `${path}?${query}` : path;
    const res = await this.http.get(url);
    return res.data;
  }

  async _post(path, params = {}) {
    const query = this._sign(params);
    const res = await this.http.post(`${path}?${query}`);
    return res.data;
  }

  async _delete(path, params = {}) {
    const query = this._sign(params);
    const res = await this.http.delete(`${path}?${query}`);
    return res.data;
  }

  // Public endpoints

  async getPrice(symbol) {
    const data = await this._get('/api/v3/ticker/price', { symbol });
    return parseFloat(data.price);
  }

  async getOrderBook(symbol, limit = 20) {
    return this._get('/api/v3/depth', { symbol, limit });
  }

  async getKlines(symbol, interval, limit = 100) {
    return this._get('/api/v3/klines', { symbol, interval, limit });
  }

  async getExchangeInfo(symbol) {
    return this._get('/api/v3/exchangeInfo', { symbol });
  }

  // Private endpoints

  async getAccount() {
    return this._get('/api/v3/account', {}, true);
  }

  async getBalance(asset) {
    const account = await this.getAccount();
    const balance = account.balances.find((b) => b.asset === asset);
    return balance
      ? { free: parseFloat(balance.free), locked: parseFloat(balance.locked) }
      : { free: 0, locked: 0 };
  }

  async getOpenOrders(symbol) {
    return this._get('/api/v3/openOrders', { symbol }, true);
  }

  async placeOrder({ symbol, side, type = 'LIMIT', price, quantity }) {
    const params = { symbol, side, type, quantity };
    if (type === 'LIMIT') {
      params.price = price;
      params.timeInForce = 'GTC';
    }

    if (this.dryRun) {
      const dryOrder = {
        orderId: `DRY-${Date.now()}`,
        symbol,
        side,
        type,
        price,
        origQty: quantity,
        status: 'DRY_RUN',
      };
      logger.info(`[DRY RUN] Would place ${side} ${type} order: ${quantity} ${symbol} @ ${price}`);
      return dryOrder;
    }

    const data = await this._post('/api/v3/order', params);
    logger.info(`Order placed: ${data.orderId} | ${side} ${quantity} ${symbol} @ ${price}`);
    return data;
  }

  async cancelOrder(symbol, orderId) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would cancel order ${orderId}`);
      return { orderId, status: 'CANCELED' };
    }
    const data = await this._delete('/api/v3/order', { symbol, orderId });
    logger.info(`Order canceled: ${orderId}`);
    return data;
  }

  async cancelAllOrders(symbol) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would cancel all orders for ${symbol}`);
      return [];
    }
    const data = await this._delete('/api/v3/openOrders', { symbol });
    logger.info(`All orders canceled for ${symbol}`);
    return data;
  }
}

module.exports = MexcClient;
