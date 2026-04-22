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

  // ─── Authentication ───────────────────────────────────────────────────────
  // Signature = HMAC-SHA256(secretKey, totalParams)
  // totalParams = all params joined as query string (including timestamp)
  // signature + timestamp are sent as regular params, NOT in headers
  // Only the API key goes in the X-MEXC-APIKEY header

  _sign(totalParams) {
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(totalParams)
      .digest('hex');
  }

  _buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  }

  _addAuthParams(params) {
    const withTime = { ...params, timestamp: Date.now() };
    const qs = this._buildQuery(withTime);
    return { ...withTime, signature: this._sign(qs) };
  }

  // ─── Response parsing ─────────────────────────────────────────────────────

  _checkError(body) {
    if (body && typeof body === 'object' && body.code !== undefined && body.msg !== undefined) {
      throw new Error(`MEXC error (code ${body.code}): ${body.msg}`);
    }
    return body;
  }

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
      const finalParams = signed ? this._addAuthParams(params) : params;
      const qs = this._buildQuery(finalParams);
      const url = qs ? `${path}?${qs}` : path;
      const headers = { 'X-MEXC-APIKEY': this.apiKey };
      const res = await this.http.get(url, { headers });
      return this._checkError(res.data);
    } catch (err) {
      if (err.message.startsWith('MEXC')) throw err;
      throw this._extractError(err);
    }
  }

  // POST /api/v3/* — all signed params (including timestamp + signature) go in
  // the request body as application/x-www-form-urlencoded, matching the curl
  // examples in the MEXC auth docs:
  //   curl -d 'symbol=…&timestamp=…&signature=…' POST /api/v3/order
  async _post(path, params = {}) {
    try {
      const withTime = { ...params, timestamp: Date.now() };
      const qs = this._buildQuery(withTime);
      const body = `${qs}&signature=${this._sign(qs)}`;
      const headers = {
        'X-MEXC-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      const res = await this.http.post(path, body, { headers });
      return this._checkError(res.data);
    } catch (err) {
      if (err.message.startsWith('MEXC')) throw err;
      throw this._extractError(err);
    }
  }

  async _delete(path, params = {}) {
    try {
      const finalParams = this._addAuthParams(params);
      const qs = this._buildQuery(finalParams);
      const url = `${path}?${qs}`;
      const headers = { 'X-MEXC-APIKEY': this.apiKey };
      const res = await this.http.delete(url, { headers });
      return this._checkError(res.data);
    } catch (err) {
      if (err.message.startsWith('MEXC')) throw err;
      throw this._extractError(err);
    }
  }

  // ─── Symbol precision cache ────────────────────────────────────────────────

  async getSymbolInfo(symbol) {
    if (this._symbolCache[symbol]) return this._symbolCache[symbol];

    const info = await this.getExchangeInfo(symbol);
    const sym = info.symbols?.[0];
    if (!sym) throw new Error(`Symbol ${symbol} not found in exchangeInfo`);

    const priceFilter = sym.filters?.find(f => f.filterType === 'PRICE_FILTER') || {};
    const lotFilter = sym.filters?.find(f => f.filterType === 'LOT_SIZE') || {};
    const notionalFilter = sym.filters?.find(f => f.filterType === 'MIN_NOTIONAL') || {};

    const result = {
      pricePrecision: sym.quotePrecision ?? sym.quoteAssetPrecision ?? 2,
      quantityPrecision: sym.baseAssetPrecision ?? 8,
      tickSize: parseFloat(priceFilter.tickSize || '0.01'),
      stepSize: parseFloat(lotFilter.stepSize || '0.00001'),
      minQty: parseFloat(lotFilter.minQty || '0.00001'),
      minNotional: parseFloat(notionalFilter.minNotional || '1'),
    };

    logger.debug(
      `Symbol info ${symbol}: tickSize=${result.tickSize} stepSize=${result.stepSize} minQty=${result.minQty}`
    );

    this._symbolCache[symbol] = result;
    return result;
  }

  _roundToStep(value, step) {
    if (!step || step <= 0) return value;
    const precision = Math.max(0, -Math.floor(Math.log10(step)));
    return parseFloat((Math.floor(value / step) * step).toFixed(precision));
  }

  // ─── Market endpoints (public, no auth required) ──────────────────────────

  // GET /api/v3/ping
  async ping() {
    return this._get('/api/v3/ping');
  }

  // GET /api/v3/time — Server time in ms
  async getServerTime() {
    const data = await this._get('/api/v3/time');
    return data.serverTime;
  }

  // GET /api/v3/exchangeInfo — Symbol rules, filters, precisions
  async getExchangeInfo(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this._get('/api/v3/exchangeInfo', params);
  }

  // GET /api/v3/depth — Order book
  async getOrderBook(symbol, limit = 20) {
    return this._get('/api/v3/depth', { symbol, limit });
  }

  // GET /api/v3/trades — Recent public trades
  async getRecentTrades(symbol, limit = 100) {
    return this._get('/api/v3/trades', { symbol, limit });
  }

  // GET /api/v3/aggTrades — Compressed/aggregate trade list
  async getAggTrades(symbol, limit = 100) {
    return this._get('/api/v3/aggTrades', { symbol, limit });
  }

  // GET /api/v3/klines — Candlestick data
  // interval: 1m | 5m | 15m | 30m | 1h | 4h | 8h | 1d | 1w | 1M
  // Returns [[timeMs, open, high, low, close, vol], ...] — compatible with all strategies
  async getKlines(symbol, interval, limit = 100) {
    const data = await this._get('/api/v3/klines', { symbol, interval, limit });
    return data.map(k => [
      k[0],
      parseFloat(k[1]),
      parseFloat(k[2]),
      parseFloat(k[3]),
      parseFloat(k[4]),
      parseFloat(k[5]),
    ]);
  }

  // GET /api/v3/avgPrice — Current average price (5-minute window)
  async getAvgPrice(symbol) {
    const data = await this._get('/api/v3/avgPrice', { symbol });
    return parseFloat(data.price);
  }

  // GET /api/v3/ticker/24hr — 24-hour rolling stats
  async getTicker24hr(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this._get('/api/v3/ticker/24hr', params);
  }

  // GET /api/v3/ticker/price — Latest price for a symbol (or all symbols)
  async getTicker(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this._get('/api/v3/ticker/price', params);
  }

  // GET /api/v3/ticker/bookTicker — Best bid/ask price and quantity
  async getBookTicker(symbol = null) {
    const params = symbol ? { symbol } : {};
    return this._get('/api/v3/ticker/bookTicker', params);
  }

  // Convenience: just the last price as a float
  async getPrice(symbol) {
    const ticker = await this.getTicker(symbol);
    return parseFloat(ticker.price);
  }

  // ─── Private endpoints (require auth) ─────────────────────────────────────

  // GET /api/v3/account — Full account info including balances
  async getAccount() {
    return this._get('/api/v3/account', {}, true);
  }

  // Convenience: free and locked balance for one asset
  async getBalance(asset) {
    const account = await this.getAccount();
    const balance = account.balances?.find(b => b.asset === asset);
    return balance
      ? { free: parseFloat(balance.free), locked: parseFloat(balance.locked) }
      : { free: 0, locked: 0 };
  }

  // GET /api/v3/openOrders — All currently open orders for a symbol
  async getOpenOrders(symbol) {
    return this._get('/api/v3/openOrders', { symbol }, true);
  }

  // GET /api/v3/order — Query a single order by orderId or clientOrderId
  async getOrder(symbol, orderId) {
    return this._get('/api/v3/order', { symbol, orderId }, true);
  }

  // GET /api/v3/allOrders — All orders (open, canceled, filled) for a symbol
  async getAllOrders(symbol, limit = 500) {
    return this._get('/api/v3/allOrders', { symbol, limit }, true);
  }

  // GET /api/v3/myTrades — Own trade history for a symbol
  async getMyTrades(symbol, limit = 500) {
    return this._get('/api/v3/myTrades', { symbol, limit }, true);
  }

  // POST /api/v3/order — Place a new order
  // side: 'BUY' | 'SELL'
  // type: 'LIMIT' | 'MARKET' (MARKET is converted to an aggressive LIMIT to
  // avoid MEXC's quoteOrderQty requirement for MARKET BUY)
  async placeOrder({ symbol, side, type = 'LIMIT', price, quantity }) {
    const info = await this.getSymbolInfo(symbol);

    const qty = Math.max(
      info.minQty,
      this._roundToStep(quantity, info.stepSize)
    );

    // Convert MARKET to an aggressive LIMIT (±1% slippage) that fills instantly
    if (type === 'MARKET') {
      const currentPrice = await this.getPrice(symbol);
      price = side === 'BUY' ? currentPrice * 1.01 : currentPrice * 0.99;
      type = 'LIMIT';
    }

    const params = { symbol, side, type, quantity: qty };

    if (type === 'LIMIT') {
      if (!price) throw new Error('LIMIT order requires a price');
      params.price = this._roundToStep(price, info.tickSize);
      params.timeInForce = 'GTC';
    }

    if (this.dryRun) {
      logger.info(
        `[DRY RUN] Would place ${side} ${type} | qty=${qty} ${symbol}${params.price ? ` @ ${params.price}` : ''}`
      );
      return {
        orderId: `DRY-${Date.now()}`,
        symbol, side, type,
        price: params.price, origQty: qty,
        status: 'DRY_RUN',
      };
    }

    const data = await this._post('/api/v3/order', params);
    logger.info(
      `Order placed: ${data.orderId} | ${side} qty=${qty} ${symbol}${data.price ? ` @ ${data.price}` : ''}`
    );
    return data;
  }

  // POST /api/v3/order/test — Test order placement (no real order)
  async testOrder({ symbol, side, type = 'LIMIT', price, quantity }) {
    const info = await this.getSymbolInfo(symbol);
    const qty = this._roundToStep(quantity, info.stepSize);
    const params = { symbol, side, type, quantity: qty };
    if (type === 'LIMIT') {
      params.price = this._roundToStep(price, info.tickSize);
      params.timeInForce = 'GTC';
    }
    return this._post('/api/v3/order/test', params);
  }

  // DELETE /api/v3/order — Cancel a single order
  async cancelOrder(symbol, orderId) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would cancel order ${orderId}`);
      return { orderId, status: 'CANCELED' };
    }
    const data = await this._delete('/api/v3/order', { symbol, orderId });
    logger.info(`Order canceled: ${orderId}`);
    return data;
  }

  // DELETE /api/v3/openOrders — Cancel all open orders for a symbol
  async cancelAllOrders(symbol) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would cancel all orders for ${symbol}`);
      return [];
    }
    const data = await this._delete('/api/v3/openOrders', { symbol });
    logger.info(`All orders canceled for ${symbol}`);
    return Array.isArray(data) ? data : [];
  }
}

module.exports = MexcClient;
