# On-Chain Activity Agent

Agent untuk memonitor transaksi on-chain multi-chain, menganalisis pergerakan whale dan exchange flow, melacak token purchases berdasarkan contract address, serta menghasilkan sinyal arah market (bullish/bearish/neutral) dengan notifikasi via Telegram.

## Fitur

- **Multi-chain** - Ethereum, BSC, Polygon, Optimism, Arbitrum, Avalanche
- **Hybrid Connection** - WebSocket real-time + Polling fallback untuk koneksi lebih stabil
- **Arkham Scraper** - Mengambil entity labels dan whale alerts dari Arkham Intelligence
- **RPC Fetcher** - Query transaksi langsung dari blockchain via RPC nodes
- **Address Labeling** - Database 100+ labelled addresses (exchange, whale, DeFi, bridge, cold/hot wallet)
- **Auto Whale Tracking** - Mendeteksi address baru yang melakukan transaksi besar, otomatis melabeli dan melanjutkan tracking
- **Token Purchase Tracking** - Melacak token apa yang dibeli whale berdasarkan contract address ERC-20
- **Token Registry** - Database token contract per chain (USDT, USDC, WBTC, PEPE, UNI, dll)
- **Cold/Hot Wallet Detection** - Mengidentifikasi transfer antara exchange, cold wallet, dan hot wallet
- **Transfer Direction Analysis** - Mendeteksi arah transfer (exchange→cold, cold→exchange, whale→exchange, dll)
- **Exchange Flow Analysis** - Deteksi inflow/outflow ke exchange
- **Market Signal Generator** - Output bullish/bearish/neutral dengan confidence score
- **Redis Cache** - Cache token transfers dan RPC blocks untuk performa lebih baik
- **Job Queue (BullMQ)** - Async processing untuk transaksi dan token purchases
- **Prometheus Metrics** - Monitoring endpoint untuk Grafana/Datadog
- **Multi-Provider Rotation** - Auto-rotate antara multiple Infura keys + fallback RPCs
- **PostgreSQL** - Histori transaksi, sinyal, tracked whales, token purchases
- **Telegram Notifications** - Alert real-time ke Telegram bot
- **Unit Testing** - Jest testing framework dengan 13 unit tests

## Prerequisites

- Node.js >= 20
- NPM
- RPC URL dari Infura/Alchemy (gratis)
- (Opsional) PostgreSQL database - Railway, Neon, Supabase, atau lokal
- (Opsional) Telegram Bot Token dari [@BotFather](https://t.me/BotFather)
- (Opsional) Redis - Railway, Upstash, atau lokal (untuk caching & job queue)

## Instalasi

```bash
git clone <repo-url>
cd create-agent
npm install
```

## Konfigurasi

Copy `.env.example` ke `.env` dan isi konfigurasinya:

```env
# Wajib - setidaknya 1 RPC URL
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_RPC_URL=https://bsc-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
OPTIMISM_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY

# WebSocket URLs (untuk hybrid mode - real-time + polling fallback)
ETH_WS_URL=wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_WS_URL=wss://bsc-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_WS_URL=wss://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_WS_URL=wss://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
AVALANCHE_WS_URL=wss://avax-mainnet.g.alchemy.com/v2/YOUR_KEY
OPTIMISM_WS_URL=wss://opt-mainnet.g.alchemy.com/v2/YOUR_KEY

# Multiple Infura Keys (otomatis rotate saat credit limit)
INFURA_KEY_1=your_infura_key_1
INFURA_KEY_2=your_infura_key_2
INFURA_KEY_3=your_infura_key_3

# Fallback RPCs (comma-separated, saat semua Infura keys habis)
ETH_RPC_FALLBACKS=https://rpc.ankr.com/eth,https://eth.llamarpc.com

# Chain yang dimonitor (chain ID, comma-separated)
MONITORED_CHAINS=1,56,137,42161,43114,10

# Arkham Intelligence
ARKHAM_BASE_URL=https://intel.arkm.com

# Interval polling (ms)
POLL_INTERVAL_MS=60000

# Minimum nilai transaksi yang di-track (USD)
MIN_TX_VALUE_USD=100000

# PostgreSQL (opsional - agent jalan tanpa DB)
DATABASE_URL=postgresql://user:password@host:port/railway

# Telegram (opsional)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=-1001234567890

# Redis (opsional - untuk caching & job queue)
REDIS_URL=redis://default:password@redis.railway.internal:6379

# WebSocket mode (true/false)
ENABLE_WEBSOCKET=true

# Job queue (true/false)
ENABLE_JOB_QUEUE=true

# Prometheus metrics port
METRICS_PORT=9090

# Multi-provider rotation (true/false)
RPC_PROVIDER_ROTATION=true
```

## Menjalankan

```bash
# Build
npm run build

# Start
npm start

# Development (auto-restart)
npm run dev

# Run unit tests
npm test

# Run unit tests in watch mode
npm run test:watch

# Run unit tests with coverage
npm run test:coverage
```

## Struktur Project

```
src/
├── index.ts                       # Entry point & polling loop
├── config.ts                      # Multi-chain configuration
├── label-db.ts                    # Address labeling engine
├── types.ts                       # Type definitions
├── analyzers/
│   ├── transaction-analyzer.ts    # Exchange flow, whale movement & transfer direction analysis
│   ├── whale-tracker.ts           # New whale detection & follow-up
│   └── token-purchase-detector.ts # Whale token purchase analysis
├── cache/
│   └── cache-service.ts           # Redis cache for token transfers & RPC blocks
├── database/
│   └── db.ts                      # PostgreSQL connection & migrations
├── fetchers/
│   ├── rpc-fetcher.ts             # RPC blockchain data fetcher
│   ├── rpc-provider-manager.ts    # Multi-provider rotation & failover
│   ├── price-fetcher.ts           # CoinGecko price fetcher
│   ├── supply-fetcher.ts          # Token supply fetcher
│   ├── token-transfer-fetcher.ts  # ERC-20 Transfer event fetcher
│   └── hybrid-connection.ts       # WebSocket + Polling fallback manager
├── metrics/
│   └── metrics-service.ts         # Prometheus metrics endpoint
├── queue/
│   └── queue-service.ts           # BullMQ job queue for async processing
├── tokens/
│   └── token-registry.ts          # Token contract registry per chain
├── reporters/
│   ├── console-reporter.ts        # Console output
│   └── telegram-reporter.ts       # Telegram notifications
├── scrapers/
│   └── arkham-scraper.ts          # Arkham Intelligence scraper
├── signals/
│   └── signal-generator.ts        # Market signal generation
├── notifications/
│   └── notification-manager.ts    # Notification deduplication
└── __tests__/
    ├── db.test.ts                 # Database unit tests
    ├── price-fetcher.test.ts      # PriceFetcher unit tests
    └── transaction-analyzer.test.ts # TransactionAnalyzer unit tests

data/
└── known-addresses.json           # Pre-labelled addresses (exchange, cold/hot wallet, DeFi)
```

## Cara Kerja

### Hybrid Connection Mode

Agent menggunakan mode **Hybrid** yang menggabungkan WebSocket dan Polling untuk koneksi yang lebih stabil:

```
┌─────────────────────────────────────────────────────────────┐
│                    HYBRID MODE                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │  WebSocket   │─────▶│  Real-time   │                    │
│  │  (Primary)   │      │  Events      │                    │
│  └──────────────┘      └──────────────┘                    │
│         │                                                 │
│         │ Jika disconnect                                 │
│         ▼                                                 │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │   Polling    │─────▶│   Fallback   │                    │
│  │  (Backup)    │      │   Mode       │                    │
│  └──────────────┘      └──────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Multi-Provider Rotation

Saat Infura credit limit habis, sistem otomatis berpindah ke provider lain:

```
┌─────────────────────────────────────────────────────────────┐
│              MULTI-PROVIDER ROTATION                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Priority 1: Infura Key Pool (auto-rotate)                 │
│    ┌────────────┐  fail  ┌────────────┐  fail  ┌────────┐ │
│    │ Infura Key │───────▶│ Infura Key │───────▶│Key 3   │ │
│    │    #1      │        │    #2      │        │        │ │
│    └────────────┘        └────────────┘        └────────┘ │
│                                                             │
│  Priority 2: Fallback RPCs (public endpoints)              │
│    ┌────────────┐  fail  ┌────────────┐  fail  ┌────────┐ │
│    │   Ankr     │───────▶│ LlamaRPC   │───────▶│Cloudfl.│ │
│    └────────────┘        └────────────┘        └────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Cara kerja:**
1. Sistem mencoba Infura Key #1
2. Jika rate limit (429) → auto-rotate ke Infura Key #2
3. Jika semua Infura keys habis → fallback ke public RPCs
4. Setiap provider di-track success/fail rate
5. Rate-limited provider akan cooldown 60 detik sebelum dicoba lagi

### Redis Cache

- Cache token transfers selama 30 detik
- Cache RPC blocks selama 15 detik
- Mengurangi RPC calls dan menghemat credits

### Job Queue (BullMQ)

- Async processing untuk transaksi besar
- Auto-retry dengan exponential backoff
- Dead letter queue untuk failed jobs

### Prometheus Metrics

- Endpoint: `http://localhost:9090/metrics`
- Health check: `http://localhost:9090/health`
- Metrics: transaction count, whale detection, cache hit rate, dll

---

Setiap polling cycle:

1. **Follow-up tracked whales** - Cek aktivitas terbaru dari whale yang sebelumnya terdeteksi
2. **Scrape Arkham** - Ambil whale alerts dari Arkham Intelligence
3. **RPC Fetch** - Scan block terbaru dari setiap chain untuk transaksi besar
4. **Token Transfer Fetch** - Fetch ERC-20 Transfer events dari token contract yang terdaftar
5. **Identify new whales** - Address tak dikenal dengan transaksi besar otomatis dilabeli dan di-track
6. **Deteksi Transfer Direction** - Identifikasi arah transfer (exchange↔cold, whale→exchange, dll)
7. **Simpan ke DB** - Transaksi, token purchases, dan sinyal disimpan ke PostgreSQL
8. **Analisis** - Hitung exchange inflow/outflow, whale accumulation/distribution, token purchases
9. **Generate signal** - Bullish/bearish/neutral berdasarkan pola
10. **Notifikasi** - Kirim alert ke console dan Telegram

### Whale Tracking Flow

```
Transaksi besar dari address tak dikenal
  → Generate label: "Whale $10M (0xabcd...1234)"
  → Simpan ke tabel whale_tracking
  → Kirim alert Telegram "🔍 NEW WHALE DETECTED"
  → Polling berikutnya: scan block untuk aktivitas address tsb
  → Update statistik (total volume, tx count)
  → Jika dana masuk exchange: flag bearish signal
```

## Reliability & Testing

### Poll Concurrency Guard
Mencegah concurrent poll execution yang bisa menyebabkan duplicate notifications dan race conditions:
- Menggunakan flag `isPolling` dengan try/finally
- Jika poll cycle sebelumnya belum selesai, cycle berikutnya akan di-skip

### Transfer Deduplication
Mencegah transfer yang sama dihitung berkali-kali:
- Deduplikasi berdasarkan `hash+chainId` sebelum analisis
- Mencegah inflated metrics dan false signals

### Batch Insert
Optimasi database performance:
- Multi-row INSERT dengan batch size 100
- Mengurangi database round-trips

### Atomic Upsert
Mencegah race conditions di database:
- `INSERT ... ON CONFLICT DO UPDATE` untuk whale_tracking
- Unique constraints pada monitored_transfers dan whale_token_purchases

### CoinGecko Rate Limiting
Mencegah API rate limit errors:
- 1 second minimum antar requests
- Logging untuk rate limit errors

### Unit Testing
Jest testing framework dengan 13 unit tests:
- Database operations (saveTransfers, upsertWhale, unique constraints)
- PriceFetcher (caching, rate limiting, fallback)
- TransactionAnalyzer (deduplication, analysis)

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Token Purchase Tracking Flow

```
ERC-20 Transfer event terdeteksi
  → Lookup token info dari Token Registry (symbol, name, decimals)
  → Filter transaksi yang melibatkan whale address
  → Hitung amount USD berdasarkan token price
  → Simpan ke tabel whale_token_purchases
  → Analisis: token apa yang paling banyak dibeli/dijual whale
  → Generate alert jika akumulasi signifikan
```

### Transfer Direction Detection

```
Transfer terdeteksi
  → Lookup label sender & receiver (cex, cold_wallet, hot_wallet, whale, dll)
  → Tentukan direction:
     - exchange_to_cold: Exchange → Cold Wallet (accumulation)
     - cold_to_exchange: Cold Wallet → Exchange (selling)
     - whale_to_exchange: Whale → Exchange (potential selling)
     - exchange_to_whale: Exchange → Whale (accumulation)
  → Tambahkan ke analysis report
```

## Label Types

| Type | Deskripsi | Emoji |
|------|-----------|-------|
| `cex` | Centralized Exchange (Binance, Coinbase, OKX) | 🏦 |
| `dex` | Decentralized Exchange (Uniswap, SushiSwap) | 🔄 |
| `cold_wallet` | Wallet penyimpanan jangka panjang | ❄️ |
| `hot_wallet` | Wallet aktif trading | 🔥 |
| `market_maker` | Market maker (Wintermute, Jump Trading) | 📊 |
| `whale` | Whale address | 🐳 |
| `bridge` | Cross-chain bridge | 🌉 |
| `lending` | Lending protocol (Aave) | 💰 |
| `liquid_staking` | Liquid staking (Lido) | 🥩 |
| `wrapped` | Wrapped token (WETH, WBTC) | 🎁 |

## Database (PostgreSQL)

Tabel otomatis dibuat saat pertama kali jalan:

- `monitored_transfers` - Histori transaksi yang terpantau
- `market_signals` - Sinyal market yang dihasilkan
- `known_addresses` - Address yang sudah dilabeli
- `whale_tracking` - Data whale yang sedang di-track
- `whale_token_purchases` - Token purchases oleh whale

### Unique Constraints

- `monitored_transfers`: `UNIQUE(hash, chain_id)`
- `whale_token_purchases`: `UNIQUE(hash, chain_id, token_address)`

### Whale Tracking Columns

- `holdings_usd` - Total holdings whale dalam USD
- `previous_percentage` - Persentase supply sebelumnya (untuk tracking akumulasi/distribusi)

Query contoh:

```sql
-- Top whales by volume
SELECT label, total_volume_usd, total_tx_count
FROM whale_tracking
WHERE status = 'active'
ORDER BY total_volume_usd DESC
LIMIT 10;

-- Recent bearish signals
SELECT direction, confidence, reason, timestamp
FROM market_signals
WHERE direction = 'bearish'
ORDER BY timestamp DESC
LIMIT 5;

-- Top tokens accumulated by whales
SELECT token_symbol, token_name, 
       SUM(CASE WHEN direction = 'buy' THEN amount_usd ELSE 0 END) as total_bought,
       COUNT(DISTINCT whale_address) as unique_whales
FROM whale_token_purchases
GROUP BY token_symbol, token_name
ORDER BY total_bought DESC
LIMIT 10;

-- Whale token activity
SELECT whale_label, token_symbol, 
       SUM(CASE WHEN direction = 'buy' THEN amount_usd ELSE 0 END) as bought,
       SUM(CASE WHEN direction = 'sell' THEN amount_usd ELSE 0 END) as sold
FROM whale_token_purchases
WHERE whale_address = '0x...'
GROUP BY whale_label, token_symbol;
```

## Token Registry

Token yang sudah terdaftar per chain:

| Chain | Tokens |
|-------|--------|
| Ethereum | USDT, USDC, WBTC, DAI, SHIB, PEPE, UNI, wstETH, stETH, LINK, AAVE, COMP, CRV, YFI |
| BSC | USDT, USDC, CAKE, BUSD, DOT, ANKR |
| Polygon | USDT, USDC, AAVE, WBTC, WETH |
| Arbitrum | USDT, USDC, ARB, WBTC |
| Avalanche | USDT, USDC, WAVAX |

Token baru bisa ditambahkan di `src/tokens/token-registry.ts` atau akan otomatis terdeteksi via ERC-20 contract query.

## Sinyal Market

### Faktor yang dianalisis

| Faktor | Bearish | Bullish |
|--------|---------|---------|
| Exchange flow | Inflow > $5M (selling) | Outflow > $5M (accumulation) |
| Whale movement | Distribution > accumulation | Accumulation > distribution |
| New whale behavior | Dana masuk exchange | Dana ke cold storage |
| Cold→Exchange | > $5M (potential selling) | - |
| Exchange→Cold | - | > $5M (accumulation) |
| Token purchase | Whale menjual token | Whale membeli token |
| Volume spike | +30% inflow confidence | -30% outflow confidence |

### Interpretasi

- **Bullish (confidence >= 30%)** - Akumulasi whale, outflow dari exchange, token purchases signifikan
- **Bearish (confidence <= -30%)** - Distribusi whale, inflow ke exchange, whale menjual token
- **Neutral** - Tidak ada sinyal dominan

## Telegram Notification Examples

### Market Signal
```
🟢 MARKET SIGNAL: BULLISH
Confidence: 65%
Large exchange outflow (-$12.5M) suggesting accumulation; Whale accumulation detected

📊 Analysis:
⬇ Net Exchange Flow: -$12.50M
💰 Total tracked: $45.20M

📈 Transfer Directions:
📈 Exchange → Cold Wallet: $8.50M
   Binance Hot 1 (hot_wallet) → Binance Cold 2 (cold_wallet)
📉 Cold Wallet → Exchange: $3.20M
   Coinbase Cold 1 (cold_wallet) → Coinbase Hot 1 (hot_wallet)
```

### Whale Token Activity
```
📈 WHALE TOKEN ACTIVITY

🐋 Whale: Whale $5M (0xabcd...1234)
🏷️ Token: PEPE (Pepe)
🌐 Chain: Ethereum
💰 Bought: $500.0K
🚗 Sold: $0.0K
📊 Net: $500.0K ACCUMULATING
📁 Contract: 0x698250814...3d2311933
⏰ 22/06/2026 12:00:00

⚠️ Monitoring for further activity
```

## License

ISC
