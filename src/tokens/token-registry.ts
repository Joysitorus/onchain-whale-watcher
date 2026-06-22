import { ethers } from 'ethers';

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
  // Ethereum
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chainId: 1, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 1, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x6b175474e89094c44da98b954eedeac495271d0f', chainId: 1, name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18, coingeckoId: 'dai' },
  { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', chainId: 1, name: 'SHIBA INU', symbol: 'SHIB', decimals: 18, coingeckoId: 'shiba-inu' },
  { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chainId: 1, name: 'Pepe', symbol: 'PEPE', decimals: 18, coingeckoId: 'pepe' },
  { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chainId: 1, name: 'Uniswap', symbol: 'UNI', decimals: 18, coingeckoId: 'uniswap' },
  { address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', chainId: 1, name: 'Wrapped stETH', symbol: 'wstETH', decimals: 18, coingeckoId: 'wrapped-steth' },
  { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', chainId: 1, name: 'Lido Staked ETH', symbol: 'stETH', decimals: 18, coingeckoId: 'staked-ether' },
  { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chainId: 1, name: 'Chainlink', symbol: 'LINK', decimals: 18, coingeckoId: 'chainlink' },
  { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', chainId: 1, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0xc00e94cb662c3520282e6f5717214004a7f26888', chainId: 1, name: 'Compound', symbol: 'COMP', decimals: 18, coingeckoId: 'compound-governance-token' },
  { address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', chainId: 1, name: 'Mirror Protocol', symbol: 'MIR', decimals: 18 },
  { address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', chainId: 1, name: 'yearn.finance', symbol: 'YFI', decimals: 18, coingeckoId: 'yearn-finance' },
  { address: '0xd533a949740bb3306d119cc777fa900ba0e4c9a5', chainId: 1, name: 'Curve DAO Token', symbol: 'CRV', decimals: 18, coingeckoId: 'curve-dao-token' },

  // BSC
  { address: '0x55d398326f99059ff775485246999027b3197955', chainId: 56, name: 'Tether USD', symbol: 'USDT', decimals: 18, coingeckoId: 'tether' },
  { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', chainId: 56, name: 'USD Coin', symbol: 'USDC', decimals: 18, coingeckoId: 'usd-coin' },
  { address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', chainId: 56, name: 'PancakeSwap', symbol: 'CAKE', decimals: 18, coingeckoId: 'pancakeswap-token' },
  { address: '0x3ee2200e23fc490f32157f0976be6ed4bc9b56aa', chainId: 56, name: 'Binance USD', symbol: 'BUSD', decimals: 18, coingeckoId: 'binance-usd' },
  { address: '0x7083609fce4d1d8dc0c97908d9208cf8f97010c5', chainId: 56, name: 'Polkadot', symbol: 'DOT', decimals: 18, coingeckoId: 'polkadot' },
  { address: '0xbf5140a2257316be06a03d13c462f7a66c6c855e', chainId: 56, name: 'Ankr', symbol: 'ANKR', decimals: 18, coingeckoId: 'ankr' },

  // Polygon
  { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', chainId: 137, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', chainId: 137, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b', chainId: 137, name: 'Aave', symbol: 'AAVE', decimals: 18, coingeckoId: 'aave' },
  { address: '0x1bfd67037b42cef7ac727a0271dd8d66d83aba8c', chainId: 137, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', chainId: 137, name: 'WETH', symbol: 'WETH', decimals: 18, coingeckoId: 'weth' },

  // Arbitrum
  { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', chainId: 42161, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', chainId: 42161, name: 'Arbitrum', symbol: 'ARB', decimals: 18, coingeckoId: 'arbitrum' },
  { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', chainId: 42161, name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, coingeckoId: 'wrapped-bitcoin' },

  // Avalanche
  { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', chainId: 43114, name: 'Tether USD', symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', chainId: 43114, name: 'USD Coin', symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  { address: '0x50b7545627a5162f82a992c33b87adc2def0e449', chainId: 43114, name: 'Wrapped AVAX', symbol: 'WAVAX', decimals: 18, coingeckoId: 'wrapped-avax' },
];

// Transfer event topic0
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class TokenRegistry {
  private tokens: Map<string, TokenInfo> = new Map();
  private providerCache: Map<number, ethers.JsonRpcProvider> = new Map();
  private fetchingContracts: Set<string> = new Set();

  constructor(rpcUrls: Map<number, string>) {
    for (const [chainId, url] of rpcUrls) {
      if (url) {
        this.providerCache.set(chainId, new ethers.JsonRpcProvider(url));
      }
    }

    for (const token of KNOWN_TOKENS) {
      const key = this.getKey(token.address, token.chainId);
      this.tokens.set(key, token);
    }

    console.log(`[TokenRegistry] Loaded ${KNOWN_TOKENS.length} known tokens`);
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

    const provider = this.providerCache.get(chainId);
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

  getTokenPrice(tokenAddress: string, chainId: number): number {
    const token = this.getToken(tokenAddress, chainId);
    if (!token?.coingeckoId) return 0;
    return 0;
  }

  getAllTokens(): TokenInfo[] {
    return Array.from(this.tokens.values());
  }

  getTokensByChain(chainId: number): TokenInfo[] {
    return Array.from(this.tokens.values()).filter(t => t.chainId === chainId);
  }
}
