const WebSocket = require('ws');
const { config } = require('./config');
const logger = require('./utils/logger');

class MexcWebSocket {
  constructor() {
    this.wsUrl = config.api.wsUrl;
    this.ws = null;
    this.handlers = {};
    this.pingInterval = null;
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 30000;
  }

  connect() {
    return new Promise((resolve, reject) => {
      logger.info('Connecting to MEXC WebSocket...');
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        logger.info('WebSocket connected');
        this._startPing();
        resolve();
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._dispatch(msg);
        } catch (e) {
          logger.debug(`WS parse error: ${e.message}`);
        }
      });

      this.ws.on('error', (err) => {
        logger.error(`WebSocket error: ${err.message}`);
        reject(err);
      });

      this.ws.on('close', () => {
        logger.warn('WebSocket disconnected, reconnecting...');
        this._stopPing();
        setTimeout(() => this._reconnect(), this.reconnectDelay);
      });
    });
  }

  _reconnect() {
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    this.connect().catch(() => {});
  }

  _startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'PING' }));
      }
    }, 20000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _dispatch(msg) {
    // Route by channel/topic
    const channel = msg.c || msg.channel;
    if (!channel) return;

    const handler = this.handlers[channel];
    if (handler) handler(msg);
  }

  subscribe(channel, handler) {
    this.handlers[channel] = handler;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [channel] }));
    }
  }

  subscribeTicker(symbol, handler) {
    const channel = `spot@public.miniTicker.v3.api@${symbol}@UTC+0`;
    this.subscribe(channel, (msg) => {
      if (msg.d) {
        handler({
          symbol: msg.s || symbol,
          price: parseFloat(msg.d.c),
          high: parseFloat(msg.d.h),
          low: parseFloat(msg.d.l),
          volume: parseFloat(msg.d.v),
          change: parseFloat(msg.d.P),
        });
      }
    });
    logger.info(`Subscribed to ticker: ${symbol}`);
  }

  subscribeOrderBook(symbol, handler) {
    const channel = `spot@public.increase.depth.v3.api@${symbol}`;
    this.subscribe(channel, (msg) => {
      if (msg.d) handler(msg.d);
    });
    logger.info(`Subscribed to order book: ${symbol}`);
  }

  subscribeTrades(symbol, handler) {
    const channel = `spot@public.deals.v3.api@${symbol}`;
    this.subscribe(channel, (msg) => {
      if (msg.d && msg.d.deals) {
        msg.d.deals.forEach((trade) =>
          handler({
            price: parseFloat(trade.p),
            quantity: parseFloat(trade.v),
            side: trade.S === 1 ? 'BUY' : 'SELL',
            time: trade.t,
          })
        );
      }
    });
    logger.info(`Subscribed to trades: ${symbol}`);
  }

  disconnect() {
    this._stopPing();
    if (this.ws) {
      this.ws.removeAllListeners('close');
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = MexcWebSocket;
