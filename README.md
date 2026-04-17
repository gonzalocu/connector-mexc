# connector-mexc

Bot de trading automatizado para el exchange **MEXC** escrito en Node.js. Soporta tres estrategias de trading, indicadores técnicos (VWAP, RSI, MA) y un sistema de alertas multi-canal.

---

## Requisitos

- Node.js >= 18
- Cuenta en [MEXC](https://www.mexc.com) con API Key creada
- (Opcional) Bot de Telegram, webhook de Discord o cuenta SMTP para alertas

---

## Instalación

```bash
git clone https://github.com/gonzalocu/connector-mexc.git
cd connector-mexc
npm install
cp .env.example .env
```

Edita el archivo `.env` con tus credenciales y configuración antes de iniciar.

---

## Configuración

Toda la configuración se hace mediante variables de entorno en el archivo `.env`.

### Credenciales API

```env
MEXC_API_KEY=tu_api_key
MEXC_SECRET_KEY=tu_secret_key
```

Para obtener las claves ve a **MEXC > Perfil > Gestión de API Keys**.  
Permisos necesarios: `Spot Trading` (lectura + trading). No habilites retiros.

### Configuración general

| Variable | Default | Descripción |
|---|---|---|
| `TRADING_SYMBOL` | `BTCUSDT` | Par de trading |
| `TRADING_STRATEGY` | `grid` | Estrategia: `grid`, `ma` o `vwap-rsi` |
| `DRY_RUN` | `true` | `true` = simula sin enviar órdenes reales |
| `MAX_OPEN_ORDERS` | `20` | Límite de órdenes abiertas simultáneas |
| `LOG_LEVEL` | `info` | Nivel de log: `error`, `warn`, `info`, `debug` |

> **Importante:** Mantén `DRY_RUN=true` mientras pruebas. Cámbialo a `false` solo cuando estés seguro de la configuración.

---

## Estrategias

### 1. Grid (`TRADING_STRATEGY=grid`)

Coloca órdenes de compra y venta en niveles de precio equidistantes dentro de un rango definido. Ideal para mercados laterales.

**Cómo funciona:**
1. Divide el rango `[GRID_LOWER_PRICE, GRID_UPPER_PRICE]` en `GRID_LEVELS` niveles.
2. Coloca órdenes BUY debajo del precio actual y SELL arriba.
3. Cuando una orden se ejecuta, coloca automáticamente la orden contraria en el nivel adyacente.

```env
GRID_UPPER_PRICE=70000    # Precio techo del grid
GRID_LOWER_PRICE=60000    # Precio piso del grid
GRID_LEVELS=10            # Número de niveles
GRID_ORDER_AMOUNT=0.001   # Cantidad por orden (en activo base, ej: BTC)
```

**Ejemplo** con BTC en 65.000 USDT, rango 60k–70k, 10 niveles:
- Paso entre niveles: 1.000 USDT
- Se colocan 5 BUY (60k–64k) y 5 SELL (66k–70k)

---

### 2. Moving Average (`TRADING_STRATEGY=ma`)

Estrategia de cruce de medias móviles simples (SMA). Detecta tendencias.

**Cómo funciona:**
- **BUY** cuando la MA corta (MA9) cruza **hacia arriba** la MA larga (MA21)
- **SELL** cuando la MA corta cruza **hacia abajo** la MA larga

```env
MA_SHORT_PERIOD=9         # Período MA rápida
MA_LONG_PERIOD=21         # Período MA lenta
MA_INTERVAL=1h            # Intervalo de velas: 1m, 5m, 15m, 30m, 1h, 4h, 1d
MA_ORDER_AMOUNT=0.001
```

---

### 3. VWAP + RSI (`TRADING_STRATEGY=vwap-rsi`)

Combina el precio promedio ponderado por volumen (VWAP) con el índice de fuerza relativa (RSI). Disponible en dos modos:

#### Modo `reversion` (default) — Reversión a la media

| Señal | Condición |
|---|---|
| **BUY** | RSI cruza hacia arriba el nivel de sobreventa (ej. 30) y el precio está cerca o por debajo del VWAP |
| **SELL** | RSI supera el nivel de sobrecompra (ej. 70) o el precio supera el VWAP por más del margen configurado |

#### Modo `momentum` — Seguimiento de tendencia

| Señal | Condición |
|---|---|
| **BUY** | Precio > VWAP y RSI > 50 y subiendo |
| **SELL** | Precio < VWAP o RSI < 50 |

```env
VWAP_RSI_INTERVAL=15m     # Intervalo de velas
VWAP_RSI_MODE=reversion   # reversion | momentum
RSI_PERIOD=14
RSI_OVERSOLD=30           # Umbral de sobreventa
RSI_OVERBOUGHT=70         # Umbral de sobrecompra
VWAP_TOLERANCE=0.5        # % de margen sobre/bajo el VWAP
VWAP_RSI_ORDER_AMOUNT=0.001
```

> **Nota sobre VWAP:** En intervalos intraday (1m, 5m, 15m, 30m) el VWAP se calcula solo con las velas del día actual (UTC). En intervalos mayores usa todas las velas disponibles.

---

## Alertas

El bot puede notificarte en tiempo real vía uno o varios canales. Configura solo los que necesites; los canales sin credenciales se ignoran automáticamente.

### Eventos que generan alerta

| Evento | Descripción |
|---|---|
| `BOT_START` / `BOT_STOP` | El bot inicia o se detiene |
| `SIGNAL` | Se detecta una señal de entrada o salida |
| `POSITION_OPEN` | Se abre una posición long |
| `POSITION_CLOSE` | Se cierra una posición (incluye % de PnL) |
| `GRID_FILL` | Una orden del grid se ejecutó |
| `ERROR` | Error crítico en alguna estrategia |

### Telegram

1. Habla con [@BotFather](https://t.me/BotFather) → `/newbot` → copia el token.
2. Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu `chat_id`.

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=987654321
```

### Discord

1. En tu servidor: **Configuración del servidor > Integraciones > Webhooks > Nuevo Webhook**.
2. Copia la URL del webhook.

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Email (SMTP)

Compatible con Gmail, Outlook, o cualquier servidor SMTP.

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=tu@gmail.com
EMAIL_PASS=tu_app_password   # Gmail: usa contraseña de aplicación
EMAIL_FROM=tu@gmail.com
EMAIL_TO=destino@email.com
```

### Webhook genérico

Recibe un `POST` con payload JSON. Útil para integraciones con Slack, Make, Zapier, etc.

```env
ALERT_WEBHOOK_URL=https://tu-servidor.com/webhook
ALERT_WEBHOOK_SECRET=clave_secreta   # Enviado como header X-Bot-Secret
```

**Ejemplo del payload recibido:**
```json
{
  "type": "SIGNAL",
  "level": "success",
  "symbol": "BTCUSDT",
  "message": "[BTCUSDT] BUY signal @ 65420 | RSI(14): 28→31",
  "side": "BUY",
  "price": 65420,
  "ts": "2026-04-17T10:30:00.000Z"
}
```

---

## Ejecución

```bash
# Iniciar el bot
npm start

# Modo desarrollo (reinicia al detectar cambios)
npm run dev
```

Los logs se muestran en consola y se guardan en `logs/bot.log`.

---

## Estructura del proyecto

```
connector-mexc/
├── .env.example                   # Plantilla de configuración
├── src/
│   ├── index.js                   # Punto de entrada
│   ├── config.js                  # Carga y valida variables de entorno
│   ├── bot.js                     # Orquestador principal
│   ├── mexcClient.js              # Cliente REST de MEXC (firma HMAC-SHA256)
│   ├── mexcWebSocket.js           # Cliente WebSocket con auto-reconexión
│   ├── strategies/
│   │   ├── gridStrategy.js        # Estrategia Grid
│   │   ├── maStrategy.js          # Estrategia MA cruzado
│   │   └── vwapRsiStrategy.js     # Estrategia VWAP + RSI
│   ├── alerts/
│   │   ├── alertManager.js        # Despachador central de alertas
│   │   └── channels/
│   │       ├── telegram.js        # Canal Telegram
│   │       ├── discord.js         # Canal Discord
│   │       ├── email.js           # Canal Email (SMTP)
│   │       └── webhook.js         # Canal Webhook HTTP
│   └── utils/
│       ├── indicators.js          # Cálculos de RSI y VWAP
│       └── logger.js              # Logger (Winston)
└── logs/
    └── bot.log                    # Archivo de log
```

---

## Advertencia

El trading algorítmico conlleva riesgo de pérdida de capital. Siempre:

- Prueba con `DRY_RUN=true` antes de usar dinero real.
- Empieza con montos pequeños (`GRID_ORDER_AMOUNT=0.001`).
- Supervisa el bot regularmente.
- Nunca inviertas más de lo que estás dispuesto a perder.
