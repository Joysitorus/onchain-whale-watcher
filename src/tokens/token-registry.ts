import { ethers } from 'ethers';
import { rpcProviderManager } from '../fetchers/rpc-provider-manager';

export interface TokenInfo {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  coingeckoId?: string;
}

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

// Well-known token contracts per chain - EXPANDED (top tokens by market cap/volume)
const KNOWN_TOKENS: TokenInfo[] = [
  // ============================================================
  // ETHEREUM (chainId: 1) - Top 50+ tokens
  // ============================================================

  // === Stablecoins (highest volume - always fetch first) ===
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0x4fabb145d64652a948d72533008f289f22246d9b', chainId: 1, name: 'Binance USD', symbol: 'BUSD', decimals: 18, coingeckoId: 'binance-usd' },
  { address: '0x853d955acef8a87723a0673a36395cd1140916b6', chainId: 1, name: 'Frax', symbol: 'FRAX', decimals: 18, coingeckoId: 'frax' },
  { address: '0x5f98805a4e8be255a32880fdec7f6728c6b38a79', chainId: 1, name: 'LUSD Stablecoin', symbol: 'LUSD', decimals: 18, coingeckoId: 'liquity-usd' },
  { address: '0x056fd409e1d7a124bd701740045a1449130f2775', chainId: 1, name: 'Gemini Dollar', symbol: 'GUSD', decimals: 2, coingeckoId: 'gemini-dollar' },
  { address: '0x8e870d07f86a0536770812de427735689e3b9e62', chainId: 1, name: 'Pax Dollar', symbol: 'USDP', decimals: 18, coingeckoId: 'paxos-standard' },
  { address: '0x0000000000085d4780B73119b644AE5ecd22b376', chainId: 1, name: 'TrueUSD', symbol: 'TUSD', decimals: 18, coingeckoId: 'true-usd' },

  // === Wrapped Assets ===
  { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', chainId: 1, name: 'Lido Staked ETH', symbol: 'stETH', decimals: 18, coingeckoId: 'staked-ether' },
  { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', chainId: 1, name: 'Wrapped stETH', symbol: 'wstETH', decimals: 18, coingeckoId: 'wrapped-steth' },
  { address: '0xae78736cd615f374d3085123a210448e74fc6393', chainId: 1, name: 'Rocket Pool ETH', symbol: 'rETH', decimals: 18, coingeckoId: 'rocket-pool-eth' },
  { address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', chainId: 1, name: 'Coinbase Wrapped BTC', symbol: 'cbBTC', decimals: 8, coingeckoId: 'coinbase-wrapped-btc' },
  { address: '0xac3e018457b222d93114458476f3e3416abbe38f', chainId: 1, name: 'Frax Ether', symbol: 'frxETH', decimals: 18, coingeckoId: 'frax-ether' },

  // === Meme Coins (high volume whale activity) ===
  { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1, name: 'SHIBA INU', symbol: 'SHIB', decimals: 18, coingeckoId: 'shiba-inu' },
  { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1, name: 'Pepe', symbol: 'PEPE', decimals: 18, coingeckoId: 'pepe' },
  { address: '0x4d224452801aced8b2f0cebdeb595f18c0bc1f62', chainId: 1, name: 'ApeCoin', symbol: 'APE', decimals: 18, coingeckoId: 'apecoin' },
  { address: '0x5026f006b85729a8b14553fae6af249ad16c9aab', chainId: 1, name: 'Floki Inu', symbol: 'FLOKI', decimals: 9, coingeckoId: 'floki' },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1, name: 'Dogecoin', symbol: 'DOGE', decimals: 18, coingeckoId: 'dogecoin' },

  // === DeFi Tokens ===
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', chainId: 1, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 1, name: 'Chainlink', symbol: 'LINK', decimals: 18, coingeckoId: 'chainlink' },
  { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', chainId: 1, name: 'Maker', symbol: 'MKR', decimals: 18, coingeckoId: 'maker' },
  { address: '0xd533a949740bb3306d119cc777fa900ba0e4c9a5', chainId: 1, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },
  { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', chainId: 1, name: 'Compound', symbol: 'COMP', decimals: 18, coingeckoId: 'compound-governance-token' },
  { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', chainId: 1, name: 'yearn.finance', symbol: 'YFI', decimals: 18, coingeckoId: 'yearn-finance' },
  { address: '0xc011a73a8503e6d3e886f7784f696ff99f80b573', chainId: 1, name: 'Synthetix', symbol: 'SNX', decimals: 18, coingeckoId: 'havven' },
  { address: '0xba100000625a3754423978a60c9317c58a424e3d', chainId: 1, name: 'Balancer', symbol: 'BAL', decimals: 18, coingeckoId: 'balancer' },
  { address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', chainId: 1, name: 'SushiSwap', symbol: 'SUSHI', decimals: 18, coingeckoId: 'sushi' },
  { address: '0x0d438f376344f29f537c2970207e69448ee5d725', chainId: 1, name: 'Lido DAO', symbol: 'LDO', decimals: 18, coingeckoId: 'lido-dao' },

  // === Infrastructure / L2 / Oracle ===
  { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', chainId: 1, name: 'Polygon', symbol: 'MATIC', decimals: 18, coingeckoId: 'matic-network' },
  { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 1, name: 'Arbitrum', symbol: 'ARB', decimals: 18, coingeckoId: 'arbitrum' },
  { address: '0x4200000000000000000000000000000000000042', chainId: 1, name: 'Optimism', symbol: 'OP', decimals: 18, coingeckoId: 'optimism' },
  { address: '0x6810e776880c021339f396283ee4f934c1d192db', chainId: 1, name: 'Golem', symbol: 'GLM', decimals: 18, coingeckoId: 'golem' },

  // === AI & Data ===
  { address: '0x4394992273588972c56cd9dcef3928d1af6e52ed', chainId: 1, name: 'Bittensor', symbol: 'TAO', decimals: 18, coingeckoId: 'bittensor' },
  { address: '0x8a2279d4a90064dded7df9521d93acabf5c57127', chainId: 1, name: 'SingularityNET', symbol: 'AGIX', decimals: 18, coingeckoId: 'singularitynet' },
  { address: '0x5d3d46a5a3b975e98c4e6a6d22f932347879c0ca', chainId: 1, name: 'Fetch.ai', symbol: 'FET', decimals: 18, coingeckoId: 'fetch-ai' },
  { address: '0x967da4048c0b73021b4d18f44ab1abf6c0189777', chainId: 1, name: 'Ocean Protocol', symbol: 'OCEAN', decimals: 18, coingeckoId: 'ocean-protocol' },
  { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', chainId: 1, name: 'Render', symbol: 'RNDR', decimals: 18, coingeckoId: 'render-token' },

  // === Gaming / Metaverse ===
  { address: '0x3845badade8e6dff0498206808b86c74707b3f58', chainId: 1, name: 'The Sandbox', symbol: 'SAND', decimals: 18, coingeckoId: 'the-sandbox' },
  { address: '0x0f5d2fb29fb7d3cfee34c1f19f0671e390612d3f', chainId: 1, name: 'Decentraland', symbol: 'MANA', decimals: 18, coingeckoId: 'decentraland' },
  { address: '0xea589e93ff18b1a1f1e9bac7ef3e86ab62addde4', chainId: 1, name: 'Axie Infinity', symbol: 'AXS', decimals: 18, coingeckoId: 'axie-infinity' },

  // === Misc Popular ===
  { address: '0x419d0d8bdd9af4e3f2da359b080014680c7009ea', chainId: 1, name: 'Near Protocol', symbol: 'NEAR', decimals: 18, coingeckoId: 'near' },
  { address: '0x53d7829128d1eb25dfe4988ebf7e5949e8c284e7', chainId: 1, name: '1inch', symbol: '1INCH', decimals: 18, coingeckoId: '1inch' },
  { address: '0x06325440d014e39736583c16ef6e516d5fe9d893', chainId: 1, name: 'Rocket Pool', symbol: 'RPL', decimals: 18, coingeckoId: 'rocket-pool' },
  { address: '0x72379f1088040388b2c2b380a7288c31529d7e69', chainId: 1, name: 'Holo', symbol: 'HOT', decimals: 18, coingeckoId: 'holotoken' },

  // ============================================================
  // BSC (chainId: 56) - Top 25 tokens
  // ============================================================

  // === Stablecoins ===
  { address: '0x55d398326f99059ff775485246999027b3197955', chainId: 56, name: 'Tether USD', symbol: 'USDT', decimals: 18, coingeckoId: 'tether' },
  { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', chainId: 56, name: 'USD Coin', symbol: 'USDC', decimals: 18, coingeckoId: 'usd-coin' },
  { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1b3b4', chainId: 56, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0xe9e7cea3dedca5984780bafc599bd69add087d56', chainId: 56, name: 'Binance USD', symbol: 'BUSD', decimals: 18, coingeckoId: 'binance-usd' },

  // === Native / Wrapped ===
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', chainId: 56, name: 'Wrapped BNB', symbol: 'WBNB', decimals: 18, coingeckoId: 'binancecoin' },
  { address: '0x7130d2a12b9bcbfee29384f2600056832b6c350c', chainId: 56, name: 'Binance Coin', symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },

  // === DeFi ===
  { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', chainId: 56, name: 'PancakeSwap', symbol: 'CAKE', decimals: 18, coingeckoId: 'pancakeswap-token' },
  { address: '0xcf6bb5389c52da157c5fd3cbe1c9006405500608', chainId: 56, name: 'Venus', symbol: 'XVS', decimals: 18, coingeckoId: 'venus' },
  { address: '0x14016e85a25aeb1310c451b1fc0c152d4a4f145f', chainId: 56, name: 'Wombat Exchange', symbol: 'WOM', decimals: 18, coingeckoId: 'wombat-exchange' },
  { address: '0xf35262a9d427f96d2437379ef090db986eaeb5bb', chainId: 56, name: 'Venus USDT', symbol: 'vUSDT', decimals: 8, coingeckoId: 'venus-usdt' },
  { address: '0xec45497e3c48a3b9b4e10babe14be6f66c332468', chainId: 56, name: 'Alpaca Finance', symbol: 'ALPACA', decimals: 18, coingeckoId: 'alpaca-finance' },

  // === Meme ===
  { address: '0x3ee2200efb342959ee4a3b0419285065299d531a', chainId: 56, name: 'Cafeswap Token', symbol: 'BREW', decimals: 18, coingeckoId: 'cafeswap-token' },
  { address: '0x85eac59c88883895d08f68243b924966f9f48148', chainId: 56, name: 'LinkTiger', symbol: 'LGR', decimals: 18 },
  { address: '0x475c33f7fb9f0f4e27a285defb1e422c2f129f4c', chainId: 56, name: 'Bull Finance', symbol: 'BULL', decimals: 18 },

  // === Gaming ===
  { address: '0x3e71f3c9b12436b2a034c34d3bc2c09cb5cb3723', chainId: 56, name: 'BinaryX', symbol: 'BNX', decimals: 18, coingeckoId: 'binaryx' },
  { address: '0x9fd6675d2013d6b151f4c680aca643635764d854', chainId: 56, name: 'Starlink', symbol: 'STARL', decimals: 18, coingeckoId: 'starlink' },

  // === Cross-chain / Infrastructure ===
  { address: '0x111111111117dc0aa78b770fa6a738034120c302', chainId: 56, name: '1inch', symbol: '1INCH', decimals: 18, coingeckoId: '1inch' },
  { address: '0x708396f17127c42383e3b9014072679662f8e441', chainId: 56, name: 'Biswap', symbol: 'BSW', decimals: 18, coingeckoId: 'biswap' },

  // ============================================================
  // POLYGON (chainId: 137) - Top 25 tokens
  // ============================================================

  // === Stablecoins ===
  { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', chainId: 137, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', chainId: 137, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', chainId: 137, name: 'USD Coin (Native)', symbol: 'USDC.e', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', chainId: 137, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0xdab529f5eee610db9af2b3295a4baf56c356b45e', chainId: 137, name: 'Frax', symbol: 'FRAX', decimals: 18, coingeckoId: 'frax' },

  // === Wrapped / Native ===
  { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chainId: 137, name: 'Wrapped Matic', symbol: 'WMATIC', decimals: 18, coingeckoId: 'wmatic' },
  { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', chainId: 137, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x1bfd67037b42cef7ac727a0271dd8d66d83aba8c', chainId: 137, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },

  // === DeFi ===
  { address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b', chainId: 137, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x9a71012b13ca4d3d0cdc72aface7fc9f491e6634', chainId: 137, name: 'Balancer', symbol: 'BAL', decimals: 18, coingeckoId: 'balancer' },
  { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chainId: 137, name: 'QuickSwap', symbol: 'QUICK', decimals: 18, coingeckoId: 'quickswap' },
  { address: '0x580a443234bf12d2e31b46960885cc5cf94b87eb', chainId: 137, name: 'Dinoswap', symbol: 'DINO', decimals: 18, coingeckoId: 'dinoswap' },
  { address: '0x25788b14639b71c279d9d320f47d095479d860df', chainId: 137, name: 'Giddy', symbol: 'GIDDY', decimals: 18 },
  { address: '0xc4ecbe4f5d1c62fba9a1326d82bd0ce8ae28e436', chainId: 137, name: 'Jarvis Synthetic Euro', symbol: 'jEUR', decimals: 18, coingeckoId: 'jarvis-synthetic-euro' },

  // === Infrastructure ===
  { address: '0x519c1071d6ff60f7d5a35eb37c30e086b4bac8d2', chainId: 137, name: 'Dogira', symbol: 'DOGIRA', decimals: 9 },
  { address: '0xb5c998c8e21fa9c2e6eb54e37e36f253b20a78d6', chainId: 137, name: 'Tetu', symbol: 'TETU', decimals: 18 },

  // === Meme ===
  { address: '0x7c00222212dd74b04130f68517f6c2b701b0a1a2', chainId: 137, name: 'Kishu Inu', symbol: 'KISHU', decimals: 18 },
  { address: '0xa18770d1c9bb3a0c2c093a5f6ab1a0777e5624d2', chainId: 137, name: 'PolyDoge', symbol: 'POLYDOGE', decimals: 18 },

  // ============================================================
  // ARBITRUM (chainId: 42161) - Top 20 tokens
  // ============================================================

  // === Stablecoins ===
  { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', chainId: 42161, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', chainId: 42161, name: 'USD Coin (Bridged)', symbol: 'USDC.e', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', chainId: 42161, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },

  // === Wrapped / Native ===
  { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', chainId: 42161, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', chainId: 42161, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },

  // === DeFi ===
  { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 42161, name: 'Arbitrum', symbol: 'ARB', decimals: 18, coingeckoId: 'arbitrum' },
  { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', chainId: 42161, name: 'GMX', symbol: 'GMX', decimals: 18, coingeckoId: 'gmx' },
  { address: '0xd4d42f0b684f36f70099c8fe3883daec41e654c6', chainId: 42161, name: 'Sperax USD', symbol: 'USDs', decimals: 18, coingeckoId: 'sperax-usd' },
  { address: '0x5979d7b546e38e9db6eb8f9a6f93c14f5c4e93f7', chainId: 42161, name: 'WOO Network', symbol: 'WOO', decimals: 18, coingeckoId: 'woo-network' },
  { address: '0x354a6da3fcde098f8389cad84b0182725c6c91de', chainId: 42161, name: 'Synapse', symbol: 'SYN', decimals: 18, coingeckoId: 'synapse' },
  { address: '0x11cdb42b0eb46d95f990bedd6520e3f245042315', chainId: 42161, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },

  // === L2 / Infrastructure ===
  { address: '0x539bde0d7dbd336b79148aa742883198bbf60342', chainId: 42161, name: 'Magic', symbol: 'MAGIC', decimals: 18, coingeckoId: 'magic' },
  { address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', chainId: 42161, name: 'Dodo', symbol: 'DODO', decimals: 18, coingeckoId: 'dodo' },

  // === Meme ===
  { address: '0x5979d7b546e38e9db6eb8f9a6f93c14f5c4e93f7', chainId: 42161, name: 'Pendle', symbol: 'PENDLE', decimals: 18, coingeckoId: 'pendle' },
  { address: '0xb50721bcf8d664c30412cffbc60d5390b879ff42', chainId: 42161, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },

  // ============================================================
  // AVALANCHE (chainId: 43114) - Top 15 tokens
  // ============================================================

  // === Stablecoins ===
  { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', chainId: 43114, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', chainId: 43114, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xc891eb4cbef3376476293697ad1fbe17fc2e455f', chainId: 43114, name: 'Tether USD (Bridged)', symbol: 'USDT.e', decimals: 6, coingeckoId: 'tether' },

  // === Wrapped / Native ===
  { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', chainId: 43114, name: 'Wrapped AVAX', symbol: 'WAVAX', decimals: 18, coingeckoId: 'wrapped-avax' },
  { address: '0x50b7545627a5162f82a992c33b87adc2def0e449', chainId: 43114, name: 'Wrapped AVAX (Bridged)', symbol: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },

  // === DeFi ===
  { address: '0x8e81fbae0e26b89726af8a92a37986de71764d41', chainId: 43114, name: 'Pangolin', symbol: 'PNG', decimals: 18, coingeckoId: 'pangolin' },
  { address: '0x60781c2586d68229fde47922133f0dacf97809db', chainId: 43114, name: 'Trader Joe', symbol: 'JOE', decimals: 18, coingeckoId: 'joe' },
  { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', chainId: 43114, name: 'Benqi', symbol: 'QI', decimals: 18, coingeckoId: 'benqi' },
  { address: '0x5ef8c9535e8fc1d5a7f64ae8e67a30e15416366d', chainId: 43114, name: 'RealT Token', symbol: 'REG', decimals: 18 },
  { address: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70', chainId: 43114, name: 'Dai Stablecoin', symbol: 'DAI.e', decimals: 18, coingeckoId: 'dai' },

  // === Meme ===
  { address: '0xf99c7e0e7733c9c69665271b43e12db40d37e318', chainId: 43114, name: 'Coq Inu', symbol: 'COQ', decimals: 18 },
  { address: '0x98458d1a5339b8f48c61a91833a529c046717686', chainId: 43114, name: 'Husky Avax', symbol: 'HUSKY', decimals: 18 },

  // ============================================================
  // OPTIMISM (chainId: 10) - Top 20 tokens
  // ============================================================

  // === Stablecoins ===
  { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', chainId: 10, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', chainId: 10, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xbfd2926b384493cde0f70d7e91b0dcd76f17b71b', chainId: 10, name: 'USD Coin (Bridged)', symbol: 'USDC.e', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', chainId: 10, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9', chainId: 10, name: 'sUSD', symbol: 'sUSD', decimals: 18, coingeckoId: 'synthetix-usd' },

  // === Wrapped / Native ===
  { address: '0x4200000000000000000000000000000000000006', chainId: 10, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', chainId: 10, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },

  // === DeFi ===
  { address: '0x4200000000000000000000000000000000000042', chainId: 10, name: 'Optimism', symbol: 'OP', decimals: 18, coingeckoId: 'optimism' },
  { address: '0x8700daec35af8ff88c16bdf0418774cb3d7599b4', chainId: 10, name: 'Synthetix', symbol: 'SNX', decimals: 18, coingeckoId: 'havven' },
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 10, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 10, name: 'Chainlink', symbol: 'LINK', decimals: 18, coingeckoId: 'chainlink' },
  { address: '0x9ea4a171d04a4b41d054384b52aab6e4d8b1b17a', chainId: 10, name: 'Velodrome', symbol: 'VELO', decimals: 18, coingeckoId: 'velodrome-finance' },
  { address: '0x3ea9f0c58483ca63c56d4e5ed530fd876fa405f1', chainId: 10, name: 'Kwenta', symbol: 'KWENTA', decimals: 18 },
  { address: '0xd6d652189a82c3d85ee419b5874893c782db49dd', chainId: 10, name: 'Synthetix', symbol: 'sETH', decimals: 18, coingeckoId: 'seth' },

  // === Infrastructure ===
  { address: '0x4c60051384bd2d3c08b58de2d557655465099454', chainId: 10, name: 'Synapse', symbol: 'SYN', decimals: 18, coingeckoId: 'synapse' },
  { address: '0xb0b195aefa48f96e43148b03400340f4715bd235', chainId: 10, name: 'RetroPGF', symbol: 'OP', decimals: 18 },
];

// Transfer event topic0
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class TokenRegistry {
  private tokens: Map<string, TokenInfo> = new Map();
  private fetchingContracts: Set<string> = new Set();
  // Token rotation: track which tokens have been scanned per chain
  private rotationIndex: Map<number, number> = new Map();

  /**
   * Validate Ethereum address format (0x + 40 hex chars)
   */
  private isValidEthAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }

  constructor(rpcUrls: Map<number, string>) {
    // Providers are now managed by rpcProviderManager (StableJsonRpcProvider)
    // No need to create raw ethers.JsonRpcProvider instances

    // Load known tokens (with address validation)
    let skippedCount = 0;
    for (const token of KNOWN_TOKENS) {
      if (!this.isValidEthAddress(token.address)) {
        console.warn(`[TokenRegistry] Skipping invalid address for ${token.symbol} on chain ${token.chainId}: ${token.address}`);
        skippedCount++;
        continue;
      }
      const key = this.getKey(token.address, token.chainId);
      this.tokens.set(key, token);
    }

    if (skippedCount > 0) {
      console.warn(`[TokenRegistry] Skipped ${skippedCount} tokens with invalid addresses`);
    }

    // Load custom tokens from environment
    this.loadCustomTokens();

    // Log per-chain token counts
    const chainCounts = new Map<number, number>();
    for (const token of this.tokens.values()) {
      chainCounts.set(token.chainId, (chainCounts.get(token.chainId) || 0) + 1);
    }
    const countStr = Array.from(chainCounts.entries())
      .map(([chain, count]) => `${this.getChainName(chain)}:${count}`)
      .join(', ');
    console.log(`[TokenRegistry] Loaded ${this.tokens.size} tokens (${countStr})`);
  }

  private getChainName(chainId: number): string {
    const names: Record<number, string> = { 1: 'ETH', 56: 'BSC', 137: 'POLY', 42161: 'ARB', 43114: 'AVAX', 10: 'OP' };
    return names[chainId] || `Chain${chainId}`;
  }

  private loadCustomTokens(): void {
    const customTokensEnv = process.env.CUSTOM_TOKENS;
    if (!customTokensEnv) return;

    try {
      const customTokens = JSON.parse(customTokensEnv) as TokenInfo[];
      for (const token of customTokens) {
        const key = this.getKey(token.address, token.chainId);
        this.tokens.set(key, {
          ...token,
          address: token.address.toLowerCase(),
        });
        console.log(`[TokenRegistry] Custom token: ${token.symbol} (${token.name}) on chain ${token.chainId}`);
      }
    } catch (err: any) {
      console.warn(`[TokenRegistry] Failed to parse CUSTOM_TOKENS: ${err.message}`);
    }
  }

  private getKey(address: string, chainId: number): string {
    return `${address.toLowerCase()}:${chainId}`;
  }

  getToken(address: string, chainId: number): TokenInfo | undefined {
    return this.tokens.get(this.getKey(address, chainId));
  }

  isKnownToken(address: string, chainId: number): boolean {
    return this.tokens.has(this.getKey(address, chainId));
  }

  async fetchTokenInfo(address: string, chainId: number): Promise<TokenInfo | null> {
    const key = this.getKey(address, chainId);
    const existing = this.tokens.get(key);
    if (existing) return existing;

    if (this.fetchingContracts.has(key)) return null;
    this.fetchingContracts.add(key);

    // Use StableJsonRpcProvider via rpcProviderManager to prevent network detection retry loop
    const provider = await rpcProviderManager.getProvider(chainId);
    if (!provider) return null;

    try {
      const contract = new ethers.Contract(address, ERC20_ABI, provider);
      const [name, symbol, decimals] = await Promise.all([
        contract.name().catch(() => 'Unknown'),
        contract.symbol().catch(() => '???'),
        contract.decimals().catch(() => 18),
      ]);

      const tokenInfo: TokenInfo = {
        address: address.toLowerCase(),
        chainId,
        name,
        symbol,
        decimals: Number(decimals),
      };

      this.tokens.set(key, tokenInfo);
      console.log(`[TokenRegistry] Discovered token: ${symbol} (${name}) on chain ${chainId}`);
      return tokenInfo;
    } catch {
      return null;
    }
  }

  getAllTokens(): TokenInfo[] {
    return Array.from(this.tokens.values());
  }

  getTokensByChain(chainId: number): TokenInfo[] {
    return Array.from(this.tokens.values()).filter(t => t.chainId === chainId);
  }

  /**
   * Get the next batch of tokens for rotation scanning.
   * Returns tokens[startIndex..startIndex+batchSize] for the given chain.
   * Wraps around to the beginning when reaching the end.
   */
  getTokensForRotation(chainId: number, batchSize: number): TokenInfo[] {
    const allTokens = this.getTokensByChain(chainId);
    if (allTokens.length === 0) return [];

    const startIndex = this.rotationIndex.get(chainId) || 0;
    const batch: TokenInfo[] = [];

    for (let i = 0; i < batchSize; i++) {
      const idx = (startIndex + i) % allTokens.length;
      batch.push(allTokens[idx]);
    }

    // Advance rotation index for next call
    this.rotationIndex.set(chainId, (startIndex + batchSize) % allTokens.length);

    return batch;
  }

  /**
   * Get total token count for a specific chain.
   */
  getTokenCountByChain(chainId: number): number {
    return this.getTokensByChain(chainId).length;
  }

  registerToken(tokenInfo: TokenInfo): void {
    const key = this.getKey(tokenInfo.address, tokenInfo.chainId);
    if (!this.tokens.has(key)) {
      this.tokens.set(key, {
        ...tokenInfo,
        address: tokenInfo.address.toLowerCase(),
      });
      console.log(`[TokenRegistry] Auto-registered: ${tokenInfo.symbol} (${tokenInfo.name}) on chain ${tokenInfo.chainId}`);
    }
  }

  getTokenCount(): number {
    return this.tokens.size;
  }
}
