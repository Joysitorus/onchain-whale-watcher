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

// Well-known token contracts per chain
const KNOWN_TOKENS: TokenInfo[] = [
  // ============================================================
  // ETHEREUM (chainId: 1) - Top 25 tokens (reduced for performance)
  // ============================================================
  
  // === Stablecoins ===
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  
  // === Wrapped Assets ===
  { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 1, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', chainId: 1, name: 'Lido Staked ETH', symbol: 'stETH', decimals: 18, coingeckoId: 'staked-ether' },
  
  // === Meme Coins ===
  { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1, name: 'SHIBA INU', symbol: 'SHIB', decimals: 18, coingeckoId: 'shiba-inu' },
  { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1, name: 'Pepe', symbol: 'PEPE', decimals: 18, coingeckoId: 'pepe' },
  { address: '0x4d224452801aced8b2f0cebdeb595f18c0bc1f62', chainId: 1, name: 'ApeCoin', symbol: 'APE', decimals: 18, coingeckoId: 'apecoin' },
  
  // === DeFi Tokens ===
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', chainId: 1, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 1, name: 'Chainlink', symbol: 'LINK', decimals: 18, coingeckoId: 'chainlink' },
  { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', chainId: 1, name: 'yearn.finance', symbol: 'YFI', decimals: 18, coingeckoId: 'yearn-finance' },
  { address: '0xd533a949740bb3306d119cc777fa900ba0e4c9a5', chainId: 1, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },
  
  // === Infrastructure ===
  { address: '0x967da4048c0b73021b4d18f44ab1abf6c0189777', chainId: 1, name: 'Ocean Protocol', symbol: 'OCEAN', decimals: 18, coingeckoId: 'ocean-protocol' },
  
  // === AI & Data ===
  { address: '0x8a2279d4a90064dded7df9521d93acabf5c57127', chainId: 1, name: 'SingularityNET', symbol: 'AGIX', decimals: 18, coingeckoId: 'singularitynet' },
  { address: '0x5d3d46a5a3b975e98c4e6a6d22f932347879c0ca', chainId: 1, name: 'Fetch.ai', symbol: 'FET', decimals: 18, coingeckoId: 'fetch-ai' },
  
  // === Gaming ===
  { address: '0x3845badade8e6dff0498206808b86c74707b3f58', chainId: 1, name: 'The Sandbox', symbol: 'SAND', decimals: 18, coingeckoId: 'the-sandbox' },
  
  // === Misc Popular ===
  { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', chainId: 1, name: 'Polygon', symbol: 'MATIC', decimals: 18, coingeckoId: 'matic-network' },
  { address: '0x419d0d8bdd9af4e3f2da359b080014680c7009ea', chainId: 1, name: 'Near Protocol', symbol: 'NEAR', decimals: 18, coingeckoId: 'near' },
  { address: '0x0f5d2fb29fb7d3cfee34c1f19f0671e390612d3f', chainId: 1, name: 'Decentraland', symbol: 'MANA', decimals: 18, coingeckoId: 'decentraland' },
  { address: '0x53d7829128d1eb25dfe4988ebf7e5949e8c284e7', chainId: 1, name: '1inch', symbol: '1INCH', decimals: 18, coingeckoId: '1inch' },
  { address: '0x06325440d014e39736583c16ef6e516d5fe9d893', chainId: 1, name: 'Rocket Pool', symbol: 'RPL', decimals: 18, coingeckoId: 'rocket-pool' },
  { address: '0x72379f1088040388b2c2b380a7288c31529d7e69', chainId: 1, name: 'Holo', symbol: 'HOT', decimals: 18, coingeckoId: 'holotoken' },
  
  // ============================================================
  // BSC (chainId: 56) - Top 5 tokens (reduced for PublicNode limits)
  // ============================================================
  { address: '0x55d398326f99059ff775485246999027b3197955', chainId: 56, name: 'Tether USD', symbol: 'USDT', decimals: 18, coingeckoId: 'tether' },
  { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', chainId: 56, name: 'USD Coin', symbol: 'USDC', decimals: 18, coingeckoId: 'usd-coin' },
  { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', chainId: 56, name: 'PancakeSwap', symbol: 'CAKE', decimals: 18, coingeckoId: 'pancakeswap-token' },
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', chainId: 56, name: 'Wrapped BNB', symbol: 'WBNB', decimals: 18, coingeckoId: 'binancecoin' },
  { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1b3b4', chainId: 56, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  
  // ============================================================
  // POLYGON (chainId: 137) - Top 8 tokens (reduced for performance)
  // ============================================================
  { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', chainId: 137, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', chainId: 137, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b', chainId: 137, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x1bfd67037b42cef7ac727a0271dd8d66d83aba8c', chainId: 137, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', chainId: 137, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chainId: 137, name: 'Wrapped Matic', symbol: 'WMATIC', decimals: 18, coingeckoId: 'wmatic' },
  { address: '0x9a71012b13ca4d3d0cdc72aface7fc9f491e6634', chainId: 137, name: 'Balancer', symbol: 'BAL', decimals: 18, coingeckoId: 'balancer' },
  
  // ============================================================
  // ARBITRUM (chainId: 42161) - Top 6 tokens (reduced for performance)
  // ============================================================
  { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', chainId: 42161, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 42161, name: 'Arbitrum', symbol: 'ARB', decimals: 18, coingeckoId: 'arbitrum' },
  { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', chainId: 42161, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', chainId: 42161, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },
  { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', chainId: 42161, name: 'GMX', symbol: 'GMX', decimals: 18, coingeckoId: 'gmx' },
  
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
