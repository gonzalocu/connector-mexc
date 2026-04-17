/**
 * RSI using Wilder's smoothed moving average method.
 * @param {number[]} closes - Array of closing prices (oldest first)
 * @param {number} period - RSI period (default 14)
 * @returns {number|null} RSI value 0-100, or null if not enough data
 */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Seed with simple average over first period
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for the rest
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

/**
 * VWAP calculated from kline data.
 * Each kline: [openTime, open, high, low, close, volume, ...]
 * Uses typical price = (high + low + close) / 3.
 * @param {Array[]} klines - Array of MEXC kline arrays
 * @returns {number|null} VWAP value, or null if no data
 */
function vwap(klines) {
  if (!klines || klines.length === 0) return null;

  let cumulativeTPV = 0; // typical price × volume
  let cumulativeVolume = 0;

  for (const k of klines) {
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);
    const close = parseFloat(k[4]);
    const volume = parseFloat(k[5]);

    const typicalPrice = (high + low + close) / 3;
    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;
  }

  if (cumulativeVolume === 0) return null;
  return parseFloat((cumulativeTPV / cumulativeVolume).toFixed(8));
}

/**
 * Filter klines to only include today's session (UTC).
 * Useful for intraday VWAP calculation.
 * @param {Array[]} klines
 * @returns {Array[]}
 */
function filterTodayKlines(klines) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();
  return klines.filter((k) => parseInt(k[0], 10) >= startMs);
}

module.exports = { rsi, vwap, filterTodayKlines };
