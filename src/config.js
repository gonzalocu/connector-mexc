require('dotenv').config();

const config = {
  api: {
    key: process.env.MEXC_API_KEY || '',
    secret: process.env.MEXC_SECRET_KEY || '',
    baseUrl: 'https://api.mexc.com',
    wsUrl: 'wss://wbs.mexc.com/ws',
  },
  trading: {
    symbol: process.env.TRADING_SYMBOL || 'BTCUSDT',
    strategy: process.env.TRADING_STRATEGY || 'grid',
    dryRun: process.env.DRY_RUN !== 'false',
    maxOpenOrders: parseInt(process.env.MAX_OPEN_ORDERS || '20', 10),
  },
  grid: {
    upperPrice: parseFloat(process.env.GRID_UPPER_PRICE || '70000'),
    lowerPrice: parseFloat(process.env.GRID_LOWER_PRICE || '60000'),
    levels: parseInt(process.env.GRID_LEVELS || '10', 10),
    orderAmount: parseFloat(process.env.GRID_ORDER_AMOUNT || '0.001'),
  },
  ma: {
    shortPeriod: parseInt(process.env.MA_SHORT_PERIOD || '9', 10),
    longPeriod: parseInt(process.env.MA_LONG_PERIOD || '21', 10),
    interval: process.env.MA_INTERVAL || '1h',
    orderAmount: parseFloat(process.env.MA_ORDER_AMOUNT || '0.001'),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

function validate() {
  if (!config.trading.dryRun && (!config.api.key || !config.api.secret)) {
    throw new Error('MEXC_API_KEY and MEXC_SECRET_KEY are required when DRY_RUN=false');
  }
  if (config.grid.upperPrice <= config.grid.lowerPrice) {
    throw new Error('GRID_UPPER_PRICE must be greater than GRID_LOWER_PRICE');
  }
  if (config.ma.shortPeriod >= config.ma.longPeriod) {
    throw new Error('MA_SHORT_PERIOD must be less than MA_LONG_PERIOD');
  }
}

module.exports = { config, validate };
