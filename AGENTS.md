# AGENTS.md

## Project Overview

On-Chain Activity Agent - Agent untuk memonitor transaksi on-chain multi-chain, menganalisis pergerakan whale, melacak token purchases berdasarkan contract address, serta menghasilkan sinyal arah market (bullish/bearish/neutral) dengan notifikasi via Telegram.

## Model

- **Model Name**: mimo-v2.5-free
- **Model ID**: opencode/mimo-v2.5-free

## Commands

```bash
# Development mode (auto-restart)
npm run dev

# Build TypeScript
npm run build

# Production mode
npm start
```

## Project Structure

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
└── notifications/
    └── notification-manager.ts    # Notification deduplication

data/
└── known-addresses.json           # Pre-labeled addresses (exchange, cold/hot wallet, DeFi)
```

## Coding Conventions

### Language
- **Code**: English (variable names, function names, comments)
- **User-facing messages**: Indonesian (Telegram notifications, console output)
- **Documentation**: Indonesian (README, AGENTS.md)

### TypeScript
- Use strict TypeScript
- Prefer interfaces over types for object shapes
- Use `async/await` over raw promises
- Handle errors with try/catch

### Naming Conventions
- **Files**: kebab-case (`token-purchase-detector.ts`)
- **Classes**: PascalCase (`TokenPurchaseDetector`)
- **Functions**: camelCase (`fetchTokenTransfers`)
- **Constants**: UPPER_SNAKE_CASE (`TRANSFER_TOPIC`)
- **Interfaces**: PascalCase (`WhaleTokenPurchase`)

### Imports
- Group imports: external libraries first, then internal modules
- Use absolute imports from project root

## Architecture

### Multi-Chain Support
- Ethereum (chainId: 1)
- BSC (chainId: 56)
- Polygon (chainId: 137)
- Arbitrum (chainId: 42161)
- Avalanche (chainId: 43114)
- Optimism (chainId: 10)

### Infura Key Distribution Strategy
Untuk mengurangi burst request pada satu key Infura, setiap key hanya menangani 2 chain:

| Infura Key | Chains |
|------------|--------|
| Key 1 | Ethereum (1), Polygon (137) |
| Key 2 | Optimism (10), Arbitrum (42161) |
| Key 3 | Avalanche (43114) |
| Public RPC | BSC (56) - Infura tidak support |

Strategi ini memastikan:
- Setiap key hanya handle 2 chain (bukan 5 seperti sebelumnya)
- Request tersebar merata, mengurangi burst
- BSC menggunakan public RPC karena Infura tidak support BSC
- Fallback ke public RPC jika key utama gagal

### Label Types
| Type | Description |
|------|-------------|
| `cex` | Centralized Exchange |
| `dex` | Decentralized Exchange |
| `cold_wallet` | Cold Wallet (long-term storage) |
| `hot_wallet` | Hot Wallet (active trading) |
| `whale` | Whale address |
| `market_maker` | Market maker |
| `bridge` | Cross-chain bridge |
| `lending` | Lending protocol |
| `liquid_staking` | Liquid staking |
| `wrapped` | Wrapped token |

### Transfer Direction Detection
| Direction | Description |
|-----------|-------------|
| `exchange_to_cold` | Exchange → Cold Wallet (accumulation) |
| `cold_to_exchange` | Cold Wallet → Exchange (selling) |
| `whale_to_exchange` | Whale → Exchange (potential selling) |
| `exchange_to_whale` | Exchange → Whale (accumulation) |

## Key Files

### Configuration
- `.env` - Environment variables (RPC URLs, Telegram token, database URL)
- `src/config.ts` - Chain configuration and settings
- `data/known-addresses.json` - Pre-labeled addresses

### Core Logic
- `src/analyzers/transaction-analyzer.ts` - Main analysis engine
- `src/analyzers/whale-tracker.ts` - Whale detection and tracking
- `src/analyzers/token-purchase-detector.ts` - Token purchase analysis

### Data Fetching
- `src/fetchers/rpc-fetcher.ts` - RPC blockchain data
- `src/fetchers/rpc-provider-manager.ts` - Multi-provider rotation & failover
- `src/fetchers/token-transfer-fetcher.ts` - ERC-20 Transfer events
- `src/tokens/token-registry.ts` - Token contract metadata

### Output
- `src/reporters/telegram-reporter.ts` - Telegram notifications
- `src/reporters/console-reporter.ts` - Console output

## Database Tables

| Table | Description |
|-------|-------------|
| `monitored_transfers` | Transaction history |
| `market_signals` | Generated market signals |
| `known_addresses` | Labeled addresses |
| `whale_tracking` | Tracked whale wallets |
| `whale_token_purchases` | Token purchases by whales |

## Common Tasks

### Adding New CEX Addresses
1. Edit `data/known-addresses.json`
2. Add address to `exchanges` section with type `cex`
3. Add corresponding `cold_wallets` and `hot_wallets` entries

### Adding New Token Contracts
1. Edit `src/tokens/token-registry.ts`
2. Add token info to `KNOWN_TOKENS` array
3. Include: address, chainId, name, symbol, decimals, coingeckoId

### Modifying Telegram Messages
1. Edit `src/reporters/telegram-reporter.ts`
2. Use `getTypeLabel()` for consistent type labels
3. Use `analyzeDestination()` for transfer analysis
4. Keep messages in Indonesian

## Environment Variables

```env
# RPC URLs for chains
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
BSC_RPC_URL=https://bsc-mainnet.infura.io/v3/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_KEY
ARBITRUM_RPC_URL=https://arbitrum-mainnet.infura.io/v3/YOUR_KEY
AVALANCHE_RPC_URL=https://avalanche-mainnet.infura.io/v3/YOUR_KEY
OPTIMISM_RPC_URL=https://optimism-mainnet.infura.io/v3/YOUR_KEY

# Multiple Infura API Keys (for automatic rotation when credit limit hit)
# Add up to 10 keys - system will rotate between them automatically
INFURA_KEY_1=your_infura_key_1
INFURA_KEY_2=your_infura_key_2
INFURA_KEY_3=your_infura_key_3

# Fallback RPC URLs (comma-separated, used when all Infura keys exhausted)
ETH_RPC_FALLBACKS=https://rpc.ankr.com/eth,https://eth.llamarpc.com
BSC_RPC_FALLBACKS=https://bsc-dataseed.binance.org/,https://rpc.ankr.com/bsc
POLYGON_RPC_FALLBACKS=https://polygon-rpc.com,https://rpc.ankr.com/polygon

# Enable multi-provider rotation (true/false)
# true = Auto-rotate between Infura keys + fallbacks (RECOMMENDED)
# false = Use single RPC_URL only
RPC_PROVIDER_ROTATION=true

# WebSocket URLs for hybrid mode (WebSocket + Polling fallback)
# Format Alchemy: wss://<network>.g.alchemy.com/v2/YOUR_KEY
# Format Infura: wss://<network>.infura.io/v3/YOUR_KEY
# WebSocket consumes credits - monitor your usage on Infura/Alchemy dashboard
ETH_WS_URL=wss://mainnet.infura.io/ws/v3/YOUR_KEY
BSC_WS_URL=wss://bsc-mainnet.infura.io/ws/v3/YOUR_KEY
POLYGON_WS_URL=wss://polygon-mainnet.infura.io/ws/v3/YOUR_KEY
ARBITRUM_WS_URL=wss://arbitrum-mainnet.infura.io/ws/v3/YOUR_KEY
AVALANCHE_WS_URL=wss://avalanche-mainnet.infura.io/ws/v3/YOUR_KEY
OPTIMISM_WS_URL=wss://optimism-mainnet.infura.io/ws/v3/YOUR_KEY

# Chain IDs to monitor (comma-separated)
MONITORED_CHAINS=1,56,137,42161,43114,10

# Arkham Intelligence (scraper)
ARKHAM_BASE_URL=https://intel.arkm.com

# Monitoring config
POLL_INTERVAL_MS=60000
MIN_TX_VALUE_USD=100000

# PostgreSQL (Railway)
DATABASE_URL=postgresql://user:password@host:port/railway

# Telegram Notifications
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Redis (Railway - add Redis service)
REDIS_URL=redis://default:password@redis.railway.internal:6379

# Prometheus Metrics
METRICS_PORT=9090

# Enable real-time WebSocket mode (true/false)
# true = HYBRID mode (WebSocket + Polling fallback) - RECOMMENDED
# false = POLLING ONLY mode
ENABLE_WEBSOCKET=true

# Job Queue (requires Redis)
ENABLE_JOB_QUEUE=true
```

## Dependencies

### Production
| Package | Version | Purpose |
|---------|---------|---------|
| `ethers` | ^6.13.0 | Ethereum blockchain interaction |
| `telegraf` | ^4.16.3 | Telegram bot |
| `pg` | ^8.21.0 | PostgreSQL database |
| `axios` | ^1.7.0 | HTTP requests |
| `pino` | ^9.0.0 | Logging |
| `pino-pretty` | ^11.0.0 | Log formatting (dev) |
| `dotenv` | ^16.4.0 | Environment variable loading |
| `redis` | ^6.0.0 | Redis cache client |
| `ioredis` | ^5.11.1 | Redis client for BullMQ |
| `bullmq` | ^5.79.1 | Job queue for async processing |
| `prom-client` | ^15.1.3 | Prometheus metrics |
| `ws` | ^8.21.0 | WebSocket client |
| `cheerio` | ^1.0.0 | HTML parsing (scraper) |

### Development
| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.5.0 | TypeScript compiler |
| `ts-node` | ^10.9.0 | TypeScript execution |
| `@types/node` | ^20.0.0 | Node.js type definitions |
| `@types/pg` | ^8.20.0 | PostgreSQL type definitions |
| `@types/ws` | ^8.18.1 | WebSocket type definitions |

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Git Conventions

### Commit Messages
```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
chore: maintenance tasks
```

### Branch Naming
```
feature/description
bugfix/description
hotfix/description
```
