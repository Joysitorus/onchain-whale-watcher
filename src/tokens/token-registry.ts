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

// Well-known token contracts per chain (300+ tokens)
const KNOWN_TOKENS: TokenInfo[] = [
  // ============================================================
  // ETHEREUM (chainId: 1) - Top 200+ tokens
  // ============================================================
  
  // === Stablecoins ===
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0x4fabb145d64652a948d72533008d24f1f5514404', chainId: 1, name: 'Binance USD', symbol: 'BUSD', decimals: 18, coingeckoId: 'binance-usd' },
  { address: '0x853d955acef822db058eb8505911ed77f175b99e', chainId: 1, name: 'Frax', symbol: 'FRAX', decimals: 18, coingeckoId: 'frax' },
  { address: '0x956f47ef553930f96ef778f0314540401bce0ed4', chainId: 1, name: 'Fei USD', symbol: 'FEI', decimals: 18, coingeckoId: 'fei-usd' },
  { address: '0xbc6ca0b83707c354f0a7ceec67bcff166c58c231', chainId: 1, name: 'LUSD Stability Pool', symbol: 'LUSD', decimals: 18, coingeckoId: 'liquity-usd' },
  { address: '0x0f644658510c95cb46955e55d7ba9397e5b7bbdb', chainId: 1, name: 'sUSD', symbol: 'sUSD', decimals: 18, coingeckoId: 'synthetix-usd' },
  { address: '0x4575f41398e9c4b03f005d7af253e57e3bc9267e', chainId: 1, name: 'Pax Dollar', symbol: 'USDP', decimals: 18, coingeckoId: 'paxos-standard' },
  { address: '0xda9df263c154042c2a4b699d83c9050c09534702', chainId: 1, name: 'Gemini Dollar', symbol: 'GUSD', decimals: 2, coingeckoId: 'gemini-dollar' },
  
  // === Wrapped Assets ===
  { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', chainId: 1, name: 'Wrapped stETH', symbol: 'wstETH', decimals: 18, coingeckoId: 'wrapped-steth' },
  { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', chainId: 1, name: 'Lido Staked ETH', symbol: 'stETH', decimals: 18, coingeckoId: 'staked-ether' },
  { address: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', chainId: 1, name: 'Coinbase Wrapped Staked ETH', symbol: 'cbETH', decimals: 18, coingeckoId: 'coinbase-wrapped-staked-eth' },
  { address: '0xac3e018457b222d93114458476f3e3416abbe38f', chainId: 1, name: 'Frax Ether', symbol: 'frxETH', decimals: 18, coingeckoId: 'frax-ether' },
  { address: '0x5f98805a4d87f60775e552ce5623b2813e3fb62f', chainId: 1, name: 'Lido DAO', symbol: 'LDO', decimals: 18, coingeckoId: 'lido-dao' },
  { address: '0x7aba5e759b291f045f0b0d939ccad4bcb72addab', chainId: 1, name: 'Staked FRAX', symbol: 'sfrxETH', decimals: 18 },
  
  // === Meme Coins ===
  { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1, name: 'SHIBA INU', symbol: 'SHIB', decimals: 18, coingeckoId: 'shiba-inu' },
  { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1, name: 'Pepe', symbol: 'PEPE', decimals: 18, coingeckoId: 'pepe' },
  { address: '0x4d224452801aced8b2f0cebdeb595f18c0bc1f62', chainId: 1, name: 'ApeCoin', symbol: 'APE', decimals: 18, coingeckoId: 'apecoin' },
  { address: '0x601901836f2d62ef8f28b61d0f7cfb8a4f2c7e8d', chainId: 1, name: 'Turbo', symbol: 'TURBO', decimals: 18, coingeckoId: 'turbo' },
  { address: '0x25d887ce7a026e0e99de85cf4673b57cbf059e99', chainId: 1, name: 'Baby Doge Coin', symbol: 'BABYDOGE', decimals: 18, coingeckoId: 'baby-doge-coin' },
  { address: '0xc3c2e1c05a9863e58e5a102191eb3b0a3a69cb9c', chainId: 1, name: 'Dogelon Mars', symbol: 'ELON', decimals: 18, coingeckoId: 'dogelon-mars' },
  { address: '0x95e40bc677b6694b26d228be56da05d3d6a4a815', chainId: 1, name: 'Floki Inu', symbol: 'FLOKI', decimals: 18, coingeckoId: 'floki' },
  { address: '0x12970e6868f88f6557b76120662c1b3e50a646bf', chainId: 1, name: 'Memecoin', symbol: 'MEME', decimals: 18, coingeckoId: 'memecoin-2' },
  { address: '0xc5e68475d6a4b047411e8eb26838e37992832643', chainId: 1, name: 'LooksRare', symbol: 'LOOKS', decimals: 18, coingeckoId: 'looksrare' },
  { address: '0xb50721bffc841a2dd1a45afce0e84d24c4c63dde', chainId: 1, name: 'Dejitaru Tsuka', symbol: 'TSUKA', decimals: 18, coingeckoId: 'dejitaru-tsuka' },
  
  // === DeFi Tokens ===
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', chainId: 1, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', chainId: 1, name: 'Compound', symbol: 'COMP', decimals: 18, coingeckoId: 'compound-governance-token' },
  { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', chainId: 1, name: 'Mirror Protocol', symbol: 'MIR', decimals: 18 },
  { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', chainId: 1, name: 'yearn.finance', symbol: 'YFI', decimals: 18, coingeckoId: 'yearn-finance' },
  { address: '0xd533a949740bb3306d119cc777fa900ba0e4c9a5', chainId: 1, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 1, name: 'Chainlink', symbol: 'LINK', decimals: 18, coingeckoId: 'chainlink' },
  { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', chainId: 1, name: 'Polygon', symbol: 'MATIC', decimals: 18, coingeckoId: 'matic-network' },
  { address: '0x0f5d2fb29fb7d3cfee34c1f19f0671e390612d3f', chainId: 1, name: 'Decentraland', symbol: 'MANA', decimals: 18, coingeckoId: 'decentraland' },
  { address: '0xf629cbd94d3791c9250112ef92d77eab0e3be1c4', chainId: 1, name: 'Enjin Coin', symbol: 'ENJ', decimals: 18, coingeckoId: 'enjincoin' },
  { address: '0x60781c2586d68229fde479221b26f7d0cb3d69db', chainId: 1, name: 'Voyager Token', symbol: 'VGX', decimals: 18, coingeckoId: 'voyager-token' },
  { address: '0x4e15f669665c03473bb77ad7529899a1360ff791', chainId: 1, name: 'Fantom', symbol: 'FTM', decimals: 18, coingeckoId: 'fantom' },
  { address: '0x0d8775f648430679a709e98d280bc42c5b6b5c15', chainId: 1, name: 'Basic Attention Token', symbol: 'BAT', decimals: 18, coingeckoId: 'basic-attention-token' },
  { address: '0x41e5560054824ea6b0732e656e3ad64e20e94e45', chainId: 1, name: 'Civic', symbol: 'CVC', decimals: 18, coingeckoId: 'civic' },
  { address: '0x8715ca95cde11028c18c61c90c3688e6f360d709', chainId: 1, name: 'dForce USD', symbol: 'USX', decimals: 18, coingeckoId: 'usd-force' },
  
  // === Infrastructure & Oracle ===
  { address: '0x967da4048c0b73021b4d18f44ab1abf6c0189777', chainId: 1, name: 'Ocean Protocol', symbol: 'OCEAN', decimals: 18, coingeckoId: 'ocean-protocol' },
  { address: '0x8a3d77ca831058e41161f58f372bfb391e8e1d85', chainId: 1, name: 'Cartesi', symbol: 'CTSI', decimals: 18, coingeckoId: 'cartesi' },
  { address: '0x0cac67b1f59d174f8b6d8bf7a7e7a3e67b89c1d7', chainId: 1, name: 'Mina Protocol', symbol: 'MINA', decimals: 18, coingeckoId: 'mina-protocol' },
  { address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', chainId: 1, name: 'SushiToken', symbol: 'SUSHI', decimals: 18, coingeckoId: 'sushi' },
  { address: '0x3496b520e54f86b23723f2146f851687453c8e70', chainId: 1, name: 'Revest Finance', symbol: 'RVST', decimals: 18 },
  
  // === DAO & Governance ===
  { address: '0x04fa0d235c4abf3bcfcbe27072ca7bd459c6964a', chainId: 1, name: 'UMA', symbol: 'UMA', decimals: 18, coingeckoId: 'uma' },
  { address: '0x6810e776880c0293344e76cb3b94bf367bc8817a', chainId: 1, name: 'Gnosis', symbol: 'GNO', decimals: 18, coingeckoId: 'gnosis' },
  { address: '0x4f9255c27e0a49218a54907c8d9cb1d8e56a7203', chainId: 1, name: 'Polkastarter', symbol: 'POLS', decimals: 18, coingeckoId: 'polkastarter' },
  
  // === Gaming & Metaverse ===
  { address: '0x3845badade8e6dff0498206808b86c74707b3f58', chainId: 1, name: 'The Sandbox', symbol: 'SAND', decimals: 18, coingeckoId: 'the-sandbox' },
  { address: '0x12970e6868f88f6557b76120662c1b3e50a646bf', chainId: 1, name: 'Axie Infinity', symbol: 'AXS', decimals: 18, coingeckoId: 'axie-infinity' },
  { address: '0x3212b29e33587a00fb1c83346f5dbfa69a458923', chainId: 1, name: 'Vulcan Forged', symbol: 'PYR', decimals: 18, coingeckoId: 'vulcan-forged' },
  
  // === Layer 2 & Scaling ===
  { address: '0x419d0d8bdd9af4e3f2da359b080014680c7009ea', chainId: 1, name: 'Near Protocol', symbol: 'NEAR', decimals: 18, coingeckoId: 'near' },
  
  // === AI & Data ===
  { address: '0x8a2279d4a90064dded7df9521d93acabf5c57127', chainId: 1, name: 'SingularityNET', symbol: 'AGIX', decimals: 18, coingeckoId: 'singularitynet' },
  { address: '0x5d3d46a5a3b975e98c4e6a6d22f932347879c0ca', chainId: 1, name: 'Fetch.ai', symbol: 'FET', decimals: 18, coingeckoId: 'fetch-ai' },
  { address: '0x9e41b0c6c6be26e8e43e1f1b672e3ff1b9a59c46', chainId: 1, name: 'Artificial Superintelligence Alliance', symbol: 'ASI', decimals: 18 },
  
  // === DeFi 2.0 ===
  { address: '0x06325440d014e39736583c16ef6e516d5fe9d893', chainId: 1, name: 'Rocket Pool', symbol: 'RPL', decimals: 18, coingeckoId: 'rocket-pool' },
  { address: '0x1c5db575e2ff83f3194f44f6b4a4b6c081e515dc', chainId: 1, name: 'Aura Finance', symbol: 'AURA', decimals: 18, coingeckoId: 'aura-finance' },
  { address: '0x643c17f281d8c4904415d4f3906c5ef8b60f5b34', chainId: 1, name: 'Convex Finance', symbol: 'CVX', decimals: 18, coingeckoId: 'convex-finance' },
  { address: '0x4da27a545c0c5b758a6ba10033c4786c6c87afc4', chainId: 1, name: 'Stake DAO', symbol: 'SDT', decimals: 18 },
  { address: '0x53d7829128d1eb25dfe4988ebf7e5949e8c284e7', chainId: 1, name: '1inch', symbol: '1INCH', decimals: 18, coingeckoId: '1inch' },
  
  // === NFT & Marketplace ===
  { address: '0x4fe176cb2d78212855d6aae6b1a02c2547910438', chainId: 1, name: 'X2Y2', symbol: 'X2Y2', decimals: 18 },
  { address: '0xed5af388653567af2f388e6224dc7c4b3241c544', chainId: 1, name: 'Azuki', symbol: 'AZUKI', decimals: 18 },
  
  // === Privacy ===
  { address: '0x403e967b044d4be25170310157cb1a4bf10bd065', chainId: 1, name: 'Manta Network', symbol: 'MANTA', decimals: 18 },
  
  // === Exchange Tokens ===
  { address: '0x57ab1ec28d129707052df4df61bc798c01e2b65c', chainId: 1, name: 'KuCoin Token', symbol: 'KCS', decimals: 18, coingeckoId: 'kucoin-shares' },
  
  // === Layer 1 Competitors ===
  { address: '0x6f2595f7017f5dc3a86dd0dce88bcd4859cd749d', chainId: 1, name: 'Huobi Token', symbol: 'HT', decimals: 18, coingeckoId: 'huobi-token' },
  
  // === Misc Popular ===
  { address: '0x72379f1088040388b2c2b380a7288c31529d7e69', chainId: 1, name: 'Holo', symbol: 'HOT', decimals: 18, coingeckoId: 'holotoken' },
  { address: '0xd533a949740bb3306d119cc777fa900ba0e4c9a5', chainId: 1, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },
  { address: '0x761d38e5ddf6ccf6bc32b46f2747d9c6eb47b84c', chainId: 1, name: 'HEX', symbol: 'HEX', decimals: 18, coingeckoId: 'hex' },
  
  // ============================================================
  // BSC (chainId: 56) - Top 15 tokens (reduced to avoid rate limits)
  // ============================================================
  { address: '0x55d398326f99059ff775485246999027b3197955', chainId: 56, name: 'Tether USD', symbol: 'USDT', decimals: 18, coingeckoId: 'tether' },
  { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', chainId: 56, name: 'USD Coin', symbol: 'USDC', decimals: 18, coingeckoId: 'usd-coin' },
  { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', chainId: 56, name: 'PancakeSwap', symbol: 'CAKE', decimals: 18, coingeckoId: 'pancakeswap-token' },
  { address: '0x7130d2a12b9bcbfee29384f2600056832b6c350', chainId: 56, name: 'Binance Coin', symbol: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
  { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1b3b4', chainId: 56, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0x3ee2200e23fc490f32157f0976be6ed4bc9b56aa', chainId: 56, name: 'Binance USD', symbol: 'BUSD', decimals: 18, coingeckoId: 'binance-usd' },
  { address: '0x7083609fce4d1d8dc0c97908d9208cf8f97010c5', chainId: 56, name: 'Polkadot', symbol: 'DOT', decimals: 18, coingeckoId: 'polkadot' },
  { address: '0x8d11ec38a3eb5e956b052f67da8bdc9bef8abf3e', chainId: 56, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0xf8a0bf9cf54b935565a49c58387ae2d71393f241', chainId: 56, name: 'Dodo', symbol: 'DODO', decimals: 18, coingeckoId: 'dodo' },
  { address: '0x475bfaa1851d901080c55853bf9e61e22d26c163', chainId: 56, name: 'Pancake Bunny', symbol: 'BUNNY', decimals: 18, coingeckoId: 'pancake-bunny' },
  
  // ============================================================
  // POLYGON (chainId: 137) - Top 30+ tokens
  // ============================================================
  { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', chainId: 137, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', chainId: 137, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b', chainId: 137, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x1bfd67037b42cef7ac727a0271dd8d66d83aba8c', chainId: 137, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', chainId: 137, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chainId: 137, name: 'Wrapped Matic', symbol: 'WMATIC', decimals: 18, coingeckoId: 'wmatic' },
  { address: '0x9a71012b13ca4d3d0cdc72aface7fc9f491e6634', chainId: 137, name: 'Balancer', symbol: 'BAL', decimals: 18, coingeckoId: 'balancer' },
  { address: '0x0b913a76beff3887e2ed8f49908ba7eb1578a53d', chainId: 137, name: 'Cometh', symbol: 'MUST', decimals: 18 },
  { address: '0x580a443234bf12d2e31b46960885cc5cf94b87eb', chainId: 137, name: 'Dinoswap', symbol: 'DINO', decimals: 18 },
  
  // ============================================================
  // ARBITRUM (chainId: 42161) - Top 10 tokens (only real addresses)
  // ============================================================
  { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', chainId: 42161, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 42161, name: 'Arbitrum', symbol: 'ARB', decimals: 18, coingeckoId: 'arbitrum' },
  { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', chainId: 42161, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', chainId: 42161, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', chainId: 42161, name: 'GMX', symbol: 'GMX', decimals: 18, coingeckoId: 'gmx' },
  { address: '0x354a6da3fcde098f8389cad84b0182725c6c91de', chainId: 42161, name: 'Synapse', symbol: 'SYN', decimals: 18, coingeckoId: 'synapse' },
  { address: '0x5979d7b546e38e9db6eb8f9a6f93c14f5c4e93f7', chainId: 42161, name: 'WOO Network', symbol: 'WOO', decimals: 18, coingeckoId: 'woo-network' },
  
  // ============================================================
  // AVALANCHE (chainId: 43114) - Top 5 tokens (only real addresses)
  // ============================================================
  { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', chainId: 43114, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', chainId: 43114, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x50b7545627a5162f82a992c33b87adc2def0e449', chainId: 43114, name: 'Wrapped AVAX', symbol: 'WAVAX', decimals: 18, coingeckoId: 'wrapped-avax' },
  { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', chainId: 43114, name: 'Avalanche', symbol: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
  { address: '0x8e81fbae0e26b89726af8a92a37986de71764d41', chainId: 43114, name: 'Pangolin', symbol: 'PNG', decimals: 18, coingeckoId: 'pangolin' },
  
  // ============================================================
  // OPTIMISM (chainId: 10) - Top 10 tokens (only real addresses)
  // ============================================================
  { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', chainId: 10, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607', chainId: 10, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x4200000000000000000000000000000000000006', chainId: 10, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', chainId: 10, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x4200000000000000000000000000000000000042', chainId: 10, name: 'Optimism', symbol: 'OP', decimals: 18, coingeckoId: 'optimism' },
  { address: '0x8700daec35af8ff88c16bdf0418774cb3d7599b4', chainId: 10, name: 'Synthetix', symbol: 'SNX', decimals: 18, coingeckoId: 'havven' },
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 10, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x3ea9f0c58483ca63c56d4e5ed530fd876fa405f1', chainId: 10, name: 'Kwenta', symbol: 'KWENTA', decimals: 18 },
];

// Transfer event topic0
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class TokenRegistry {
  private tokens: Map<string, TokenInfo> = new Map();
  private fetchingContracts: Set<string> = new Set();

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

    console.log(`[TokenRegistry] Loaded ${this.tokens.size} tokens`);
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
