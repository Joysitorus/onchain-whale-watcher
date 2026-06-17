# On-Chain Activity Agent

Agent untuk memonitor transaksi on-chain multi-chain, menganalisis pergerakan whale dan exchange flow, serta menghasilkan sinyal arah market (bullish/bearish/neutral) dengan notifikasi via Telegram.

## Fitur

- **Multi-chain** - Ethereum, BSC, Polygon, Optimism, Arbitrum, Avalanche
- **Arkham Scraper** - Mengambil entity labels dan whale alerts dari Arkham Intelligence
- **RPC Fetcher** - Query transaksi langsung dari blockchain via RPC nodes
- **Address Labeling** - Database 40+ labelled addresses (exchange, whale, DeFi, bridge)
- **Auto Whale Tracking** - Mendeteksi address baru yang melakukan transaksi besar, otomatis melabeli dan melanjutkan tracking
- **Exchange Flow Analysis** - Deteksi inflow/outflow ke exchange
- **Market Signal Generator** - Output bullish/bearish/neutral dengan confidence score
- **PostgreSQL** - Histori transaksi, sinyal, tracked whales
- **Telegram Notifications** - Alert real-time ke Telegram bot

## Prerequisites

- Node.js >= 20
- NPM
- RPC URL dari Infura/Alchemy (gratis)
- (Opsional) PostgreSQL database - Railway, Neon, Supabase, atau lokal
- (Opsional) Telegram Bot Token dari [@BotFather](https://t.me/BotFather)

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

# Chain yang dimonitor (chain ID, comma-separated)
MONITORED_CHAINS=1,56,137

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
```

## Menjalankan

```bash
# Build
npm run build

# Start
npm start

# Development (auto-restart)
npm run dev
```

## Struktur Project

```
src/
├── index.ts                       # Entry point & polling loop
├── config.ts                      # Multi-chain configuration
├── label-db.ts                    # Address labeling engine
├── types.ts                       # Type definitions
├── analyzers/
│   ├── transaction-analyzer.ts    # Exchange flow & whale movement analysis
│   └── whale-tracker.ts           # New whale detection & follow-up
├── database/
│   └── db.ts                      # PostgreSQL connection & migrations
├── fetchers/
│   └── rpc-fetcher.ts             # RPC blockchain data fetcher
├── reporters/
│   ├── console-reporter.ts        # Console output
│   └── telegram-reporter.ts       # Telegram notifications
├── scrapers/
│   └── arkham-scraper.ts          # Arkham Intelligence scraper
└── signals/
    └── signal-generator.ts        # Market signal generation
data/
└── known-addresses.json           # Pre-labelled addresses
```

## Cara Kerja

Setiap polling cycle:

1. **Follow-up tracked whales** - Cek aktivitas terbaru dari whale yang sebelumnya terdeteksi
2. **Scrape Arkham** - Ambil whale alerts dari Arkham Intelligence
3. **RPC Fetch** - Scan block terbaru dari setiap chain untuk transaksi besar
4. **Identify new whales** - Address tak dikenal dengan transaksi besar otomatis dilabeli dan di-track
5. **Simpan ke DB** - Transaksi dan sinyal disimpan ke PostgreSQL
6. **Analisis** - Hitung exchange inflow/outflow, whale accumulation/distribution
7. **Generate signal** - Bullish/bearish/neutral berdasarkan pola
8. **Notifikasi** - Kirim alert ke console dan Telegram

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

## Database (PostgreSQL)

Tabel otomatis dibuat saat pertama kali jalan:

- `monitored_transfers` - Histori transaksi yang terpantau
- `market_signals` - Sinyal market yang dihasilkan
- `known_addresses` - Address yang sudah dilabeli
- `whale_tracking` - Data whale yang sedang di-track

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
```

## Sinyal Market

### Faktor yang dianalisis

| Faktor | Bearish | Bullish |
|--------|---------|---------|
| Exchange flow | Inflow > $5M (selling) | Outflow > $5M (accumulation) |
| Whale movement | Distribution > accumulation | Accumulation > distribution |
| New whale behavior | Dana masuk exchange | Dana ke cold storage |
| Volume spike | +30% inflow confidence | -30% outflow confidence |

### Interpretasi

- **Bullish (confidence >= 30%)** - Akumulasi whale, outflow dari exchange
- **Bearish (confidence <= -30%)** - Distribusi whale, inflow ke exchange
- **Neutral** - Tidak ada sinyal dominan
