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
    this._symbolCache = {};

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  // ─── Signing ──────────────────────────────────────────────────────────────

  // Signature = HMAC-SHA256( apiKey + timestamp + paramString )
  _buildAuthHeaders(paramString) {
    const timestamp = String(Date.now());
    const toSign = this.apiKey + timestamp + paramString;
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(toSign)
      .digest('hex');
    return {
      'ApiKey': this.apiKey,
      'Request-Time': timestamp,
      'Signature': signature,
      'Content-Type': 'application/json',
    };
  }

  // GET / DELETE: sort params alphabetically, filter nulls, join with &
  _buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  }

  // ─── Error handling ───────────────────────────────────────────────────────

  _extractError(err) {
    if (err.response) {
      const d = err.response.data;
      const msg = d?.msg || d?.message || JSON.stringify(d);
      return new Error(`MEXC ${err.response.status} (code ${d?.code ?? '?'}): ${msg}`);
    }
    return err;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  async _get(path, params = {}, signed = false) {
    try {
      const query = this._buildQuery(params);
      const url = query ? `${path}?${query}` : path;
      const headers = signed ? this._buildAuthHeaders(query) : {};
      const res = await this.http.get(url, { headers });
      return res.data;
    } catch (err) {
      throw this._extractError(err);
    }
  }

  // POST: JSON body, sign over the raw JSON string
  async _post(path, params = {}) {
    try {
      const bodyStr = JSON.stringify(params);
      const headers = this._buildAuthHeaders(bodyStr);
      const res = await this.http.post(path, params, { headers });
      return res.data;
    } catch (err) {
      throw this._extractError(err);
    }
  }

  // DELETE: params in query string, signed same as GET
  async _delete(path, params = {}) {
    try {
      const query = this._buildQuery(params);
      const url = query ? `${path}?${query}` : path;
      const headers = this._buildAuthHeaders(query);
      const res = await this.http.delete(url, { headers });
      return res.data;
    } catch (err) {
      throw this._extractError(err);
    }
  }

  // ─── Symbol precision ─────────────────────────────────────────────────────

  _countDecimals(value) {
    const str = parseFloat(value).toFixed(10).replace(/\.?0+$/, '');
    return str.includes('.') ? str.split('.')[1].length : 0;
  }

  async getSymbolInfo(symbol) {
    if (this._symbolCache[symbol]) return this._symbolCache[symbol];

    const data = await this._get('/api/v3/exchangeInfo', { symbol });
    const info = data.symbols?.[0];
    if (!info) throw new Error(`Symbol ${symbol} not found in exchangeInfo`);

    const lotFilter   = info.filters?.find((f) => f.filterType === 'LOT_SIZE');
    const priceFilter = info.filters?.find((f) => f.filterType === 'PRICE_FILTER');
    const notional    = info.filters?.find((f) => f.filterType === 'MIN_NOTIONAL');

    const result = {
      qtyPrecision:   lotFilter   ? this._countDecimals(lotFilter.stepSize)   : 6,
      pricePrecision: priceFilter ? this._countDecimals(priceFilter.tickSize) : 2,
      minQty:         parseFloat(lotFilter?.minQty   || '0'),
      stepSize:       parseFloat(lotFilter?.stepSize || '0.001'),
      tickSize:       parseFloat(priceFilter?.tickSize || '0.01'),
      minNotional:    parseFloat(notional?.minNotional || '0'),
    };

    logger.debug(
      `Symbol info ${symbol}: qtyPrecision=${result.qtyPrecision} ` +
      `pricePrecision=${result.pricePrecision} minQty=${result.minQty} ` +
      `stepSize=${result.stepSize} minNotional=${result.minNotional}`
    );

    this._symbolCache[symbol] = result;
    return result;
  }

  _roundToStep(value, step) {
    const inv = 1 / step;
    return Math.floor(parseFloat(value) * inv) / inv;
  }

  // ─── Public endpoints ─────────────────────────────────────────────────────

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

  // ─── Private endpoints ────────────────────────────────────────────────────

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
    const info = await this.getSymbolInfo(symbol);

    const qty = this._roundToStep(quantity, info.stepSize);
    if (qty < info.minQty) {
      throw new Error(
        `Order quantity ${qty} is below minQty ${info.minQty} for ${symbol}`
      );
    }

    const params = {
      symbol,
      side,
      type,
      quantity: qty.toFixed(info.qtyPrecision),
    };

    if (type === 'LIMIT') {
      if (!price) throw new Error('LIMIT order requires a price');
      const roundedPrice = this._roundToStep(price, info.tickSize);
      params.price = roundedPrice.toFixed(info.pricePrecision);
      params.timeInForce = 'GTC';

      const notional = parseFloat(params.price) * qty;
      if (info.minNotional > 0 && notional < info.minNotional) {
        throw new Error(
          `Order notional ${notional.toFixed(4)} is below minNotional ` +
          `${info.minNotional} for ${symbol}`
        );
      }
    }

    if (this.dryRun) {
      logger.info(
        `[DRY RUN] Would place ${side} ${type} | qty=${params.quantity} ` +
        `${symbol}${params.price ? ` @ ${params.price}` : ''}`
      );
      return {
        orderId: `DRY-${Date.now()}`,
        symbol, side, type,
        price: params.price,
        origQty: params.quantity,
        status: 'DRY_RUN',
      };
    }

    const data = await this._post('/api/v3/order', params);
    logger.info(
      `Order placed: ${data.orderId} | ${side} ${params.quantity} ${symbol}` +
      `${params.price ? ` @ ${params.price}` : ''}`
    );
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
