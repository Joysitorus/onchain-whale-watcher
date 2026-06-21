import dotenv from 'dotenv';
dotenv.config();

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeToken: string;
  explorerUrl: string;
}

const CHAIN_MAP: Record<number, Omit<ChainConfig, 'rpcUrl'>> = {
  1: { chainId: 1, name: 'Ethereum', nativeToken: 'ETH', explorerUrl: 'https://etherscan.io' },
  56: { chainId: 56, name: 'BSC', nativeToken: 'BNB', explorerUrl: 'https://bscscan.com' },
  137: { chainId: 137, name: 'Polygon', nativeToken: 'MATIC', explorerUrl: 'https://polygonscan.com' },
  10: { chainId: 10, name: 'Optimism', nativeToken: 'ETH', explorerUrl: 'https://optimistic.etherscan.io' },
  42161: { chainId: 42161, name: 'Arbitrum', nativeToken: 'ETH', explorerUrl: 'https://arbiscan.io' },
  43114: { chainId: 43114, name: 'Avalanche', nativeToken: 'AVAX', explorerUrl: 'https://snowtrace.io' },
};

const RPC_URL_ALIASES: Record<number, string[]> = {
  1: ['ETH_RPC_URL', 'ETHEREUM_RPC_URL'],
  56: ['BSC_RPC_URL'],
  137: ['POLYGON_RPC_URL'],
  10: ['OPTIMISM_RPC_URL'],
  42161: ['ARBITRUM_RPC_URL'],
  43114: ['AVALANCHE_RPC_URL'],
};

function getMonitoredChains(): ChainConfig[] {
  const chainIds = (process.env.MONITORED_CHAINS || '1').split(',').map(Number);
  return chainIds.map(id => {
    const base = CHAIN_MAP[id];
    if (!base) throw new Error(`Unknown chain ID: ${id}`);
    const aliases = RPC_URL_ALIASES[id] || [`${base.name.toUpperCase()}_RPC_URL`];
    const rpcUrl = aliases.map(k => process.env[k]).find(Boolean) || '';
    return { ...base, rpcUrl };
  });
}

export const config = {
  chains: getMonitoredChains(),
  arkhamBaseUrl: process.env.ARKHAM_BASE_URL || 'https://intel.arkm.com',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '60000', 10),
  minTxValueUsd: parseInt(process.env.MIN_TX_VALUE_USD || '100000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
};
