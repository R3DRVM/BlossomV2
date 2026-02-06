/**
 * Cross-Chain Portfolio Service
 * Aggregates balances and positions across Ethereum and Solana
 *
 * Features:
 * - Unified balance view across chains
 * - Combined USD valuation
 * - Position tracking across chains
 * - Real-time price updates via Pyth/Jupiter
 */

import { getPrice, type PriceSymbol } from './prices';
import { SolanaClient } from '../solana/solanaClient';
import { getTokenBalance, SOLANA_TOKEN_MINTS } from '../solana/jupiter';
import { getPythPriceForSymbol } from '../solana/pyth';
import { getJupiterPriceUsd } from '../solana/jupiter';

// Chain identifiers
export type ChainId = 'ethereum' | 'solana';
export type NetworkId = 'mainnet' | 'sepolia' | 'devnet';

// Token balance structure
export interface TokenBalance {
  chain: ChainId;
  network: NetworkId;
  symbol: string;
  address: string; // Token contract address or mint
  balance: string; // Raw balance in smallest unit
  uiBalance: number; // Human-readable balance
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

// Position structure (perps, lending, etc.)
export interface CrossChainPosition {
  id: string;
  chain: ChainId;
  network: NetworkId;
  venue: string;
  type: 'perp' | 'lending' | 'staking' | 'lp' | 'event';
  market?: string;
  side?: 'long' | 'short';
  size?: number;
  notionalUsd?: number;
  leverage?: number;
  pnlUsd?: number;
  pnlPct?: number;
  openedAt?: number;
  metadata?: Record<string, any>;
}

// Aggregated portfolio snapshot
export interface PortfolioSnapshot {
  timestamp: number;
  totalValueUsd: number;
  chains: {
    ethereum: ChainBalances;
    solana: ChainBalances;
  };
  positions: CrossChainPosition[];
  summary: {
    spotValueUsd: number;
    defiValueUsd: number;
    perpExposureUsd: number;
    eventExposureUsd: number;
  };
}

// Per-chain balances
export interface ChainBalances {
  chain: ChainId;
  network: NetworkId;
  nativeBalance: TokenBalance;
  tokenBalances: TokenBalance[];
  totalValueUsd: number;
  isConnected: boolean;
  lastUpdated: number;
}

/**
 * Cross-Chain Portfolio Service
 */
export class CrossChainPortfolioService {
  private ethereumRpcUrl: string;
  private solanaRpcUrl: string;
  private solanaClient: SolanaClient;
  private ethereumChainId: number;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTtlMs: number = 30000; // 30 seconds

  constructor(config?: {
    ethereumRpcUrl?: string;
    solanaRpcUrl?: string;
    ethereumChainId?: number;
  }) {
    this.ethereumRpcUrl = config?.ethereumRpcUrl || process.env.ETH_TESTNET_RPC_URL || '';
    this.solanaRpcUrl = config?.solanaRpcUrl || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.ethereumChainId = config?.ethereumChainId || 11155111; // Sepolia default
    this.solanaClient = new SolanaClient({ rpcUrl: this.solanaRpcUrl });
  }

  /**
   * Get full portfolio snapshot for a user
   */
  async getPortfolioSnapshot(params: {
    ethereumAddress?: string;
    solanaAddress?: string;
  }): Promise<PortfolioSnapshot> {
    const { ethereumAddress, solanaAddress } = params;
    const timestamp = Date.now();

    // Fetch balances in parallel
    const [ethereumBalances, solanaBalances] = await Promise.all([
      ethereumAddress ? this.getEthereumBalances(ethereumAddress) : null,
      solanaAddress ? this.getSolanaBalances(solanaAddress) : null,
    ]);

    // Fetch positions (would integrate with ledger in production)
    const positions = await this.getPositions({ ethereumAddress, solanaAddress });

    // Calculate totals
    const ethereumValue = ethereumBalances?.totalValueUsd || 0;
    const solanaValue = solanaBalances?.totalValueUsd || 0;
    const positionsValue = positions.reduce((sum, p) => sum + (p.notionalUsd || 0), 0);

    // Calculate summary
    const spotValueUsd = ethereumValue + solanaValue;
    const perpExposureUsd = positions
      .filter(p => p.type === 'perp')
      .reduce((sum, p) => sum + (p.notionalUsd || 0), 0);
    const eventExposureUsd = positions
      .filter(p => p.type === 'event')
      .reduce((sum, p) => sum + (p.notionalUsd || 0), 0);
    const defiValueUsd = positions
      .filter(p => p.type === 'lending' || p.type === 'lp' || p.type === 'staking')
      .reduce((sum, p) => sum + (p.notionalUsd || 0), 0);

    return {
      timestamp,
      totalValueUsd: spotValueUsd + defiValueUsd,
      chains: {
        ethereum: ethereumBalances || this.emptyChainBalances('ethereum'),
        solana: solanaBalances || this.emptyChainBalances('solana'),
      },
      positions,
      summary: {
        spotValueUsd,
        defiValueUsd,
        perpExposureUsd,
        eventExposureUsd,
      },
    };
  }

  /**
   * Get Ethereum balances for an address
   */
  async getEthereumBalances(address: string): Promise<ChainBalances> {
    const network: NetworkId = this.ethereumChainId === 1 ? 'mainnet' : 'sepolia';

    try {
      if (!this.ethereumRpcUrl) {
        return this.emptyChainBalances('ethereum', network);
      }

      // Fetch ETH balance via RPC
      const ethBalanceHex = await this.ethRpcCall('eth_getBalance', [address, 'latest']);
      const ethBalanceWei = BigInt(ethBalanceHex);
      const ethBalance = Number(ethBalanceWei) / 1e18;

      // Get ETH price
      const ethPrice = await getPrice('ETH');

      const nativeBalance: TokenBalance = {
        chain: 'ethereum',
        network,
        symbol: 'ETH',
        address: '0x0000000000000000000000000000000000000000',
        balance: ethBalanceWei.toString(),
        uiBalance: ethBalance,
        decimals: 18,
        priceUsd: ethPrice.priceUsd,
        valueUsd: ethBalance * ethPrice.priceUsd,
      };

      // Fetch common token balances (USDC, WETH)
      const tokenBalances: TokenBalance[] = [];

      // USDC on Sepolia
      const usdcAddress = process.env.DEMO_REDACTED_ADDRESS || '0x942eF9C37469a43077C6Fb5f23a258a6D88599cD';
      const usdcBalanceResult = await this.getErc20Balance(address, usdcAddress);
      if (usdcBalanceResult) {
        tokenBalances.push({
          chain: 'ethereum',
          network,
          symbol: 'USDC',
          address: usdcAddress,
          balance: usdcBalanceResult.balance,
          uiBalance: usdcBalanceResult.uiBalance,
          decimals: 6,
          priceUsd: 1,
          valueUsd: usdcBalanceResult.uiBalance,
        });
      }

      // WETH on Sepolia
      const wethAddress = process.env.DEMO_WETH_ADDRESS || '0x5FB58E6E0adB7002a6E0792BE3aBE084922c9939';
      const wethBalanceResult = await this.getErc20Balance(address, wethAddress);
      if (wethBalanceResult) {
        tokenBalances.push({
          chain: 'ethereum',
          network,
          symbol: 'WETH',
          address: wethAddress,
          balance: wethBalanceResult.balance,
          uiBalance: wethBalanceResult.uiBalance,
          decimals: 18,
          priceUsd: ethPrice.priceUsd,
          valueUsd: wethBalanceResult.uiBalance * ethPrice.priceUsd,
        });
      }

      // Calculate total value
      const totalValueUsd =
        (nativeBalance.valueUsd || 0) +
        tokenBalances.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

      return {
        chain: 'ethereum',
        network,
        nativeBalance,
        tokenBalances,
        totalValueUsd,
        isConnected: true,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error('[crossChainPortfolio] Ethereum balance error:', error);
      return this.emptyChainBalances('ethereum', network);
    }
  }

  /**
   * Get Solana balances for an address
   */
  async getSolanaBalances(address: string): Promise<ChainBalances> {
    const network: NetworkId = this.solanaRpcUrl.includes('devnet') ? 'devnet' : 'mainnet';

    try {
      // Fetch SOL balance
      const solBalance = await this.solanaClient.getBalance(address);

      // Get SOL price (try Pyth first, then Jupiter)
      let solPriceUsd = await getPythPriceForSymbol('SOL');
      if (!solPriceUsd) {
        solPriceUsd = await getJupiterPriceUsd('SOL');
      }
      solPriceUsd = solPriceUsd || 100; // Fallback

      const nativeBalance: TokenBalance = {
        chain: 'solana',
        network,
        symbol: 'SOL',
        address: SOLANA_TOKEN_MINTS.SOL,
        balance: solBalance.lamports.toString(),
        uiBalance: solBalance.sol,
        decimals: 9,
        priceUsd: solPriceUsd,
        valueUsd: solBalance.sol * solPriceUsd,
      };

      // Fetch USDC balance
      const tokenBalances: TokenBalance[] = [];
      const usdcMint = network === 'devnet' ? SOLANA_TOKEN_MINTS.USDC_DEVNET : SOLANA_TOKEN_MINTS.USDC;
      const usdcBalance = await getTokenBalance({
        walletAddress: address,
        tokenMint: usdcMint,
        rpcUrl: this.solanaRpcUrl,
      });

      if (usdcBalance && usdcBalance.uiAmount > 0) {
        tokenBalances.push({
          chain: 'solana',
          network,
          symbol: 'USDC',
          address: usdcMint,
          balance: usdcBalance.balance,
          uiBalance: usdcBalance.uiAmount,
          decimals: usdcBalance.decimals,
          priceUsd: 1,
          valueUsd: usdcBalance.uiAmount,
        });
      }

      // Calculate total value
      const totalValueUsd =
        (nativeBalance.valueUsd || 0) +
        tokenBalances.reduce((sum, t) => sum + (t.valueUsd || 0), 0);

      return {
        chain: 'solana',
        network,
        nativeBalance,
        tokenBalances,
        totalValueUsd,
        isConnected: true,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error('[crossChainPortfolio] Solana balance error:', error);
      return this.emptyChainBalances('solana', network);
    }
  }

  /**
   * Get positions from the execution ledger
   * In production, this would query the ledger database
   */
  async getPositions(params: {
    ethereumAddress?: string;
    solanaAddress?: string;
  }): Promise<CrossChainPosition[]> {
    // This would integrate with the execution ledger in production
    // For now, return empty array (positions are stored in ledger)
    const positions: CrossChainPosition[] = [];

    try {
      // Dynamic import to avoid circular dependencies
      const { getOpenPositionsAsync } = await import('../../execution-ledger/db');

      if (params.ethereumAddress) {
        const ethPositions = await getOpenPositionsAsync({ user_address: params.ethereumAddress });
        for (const pos of ethPositions) {
          positions.push({
            id: pos.id,
            chain: 'ethereum',
            network: 'sepolia',
            venue: pos.venue,
            type: pos.venue.includes('perp') ? 'perp' : 'lending',
            market: pos.market,
            side: pos.side as 'long' | 'short',
            leverage: pos.leverage,
            notionalUsd: pos.size_units ? Number(pos.size_units) / 1e6 : undefined,
            openedAt: pos.created_at ? new Date(pos.created_at).getTime() : undefined,
          });
        }
      }
    } catch (error) {
      console.warn('[crossChainPortfolio] Could not fetch positions:', error);
    }

    return positions;
  }

  /**
   * Get aggregated exposure by asset across all chains
   */
  async getExposureByAsset(params: {
    ethereumAddress?: string;
    solanaAddress?: string;
  }): Promise<Array<{ asset: string; valueUsd: number; percentage: number; chain: ChainId }>> {
    const snapshot = await this.getPortfolioSnapshot(params);

    const exposureMap = new Map<string, { valueUsd: number; chain: ChainId }>();

    // Add native balances
    if (snapshot.chains.ethereum.isConnected) {
      const ethBalance = snapshot.chains.ethereum.nativeBalance;
      if (ethBalance.valueUsd && ethBalance.valueUsd > 0) {
        exposureMap.set('ETH', {
          valueUsd: ethBalance.valueUsd,
          chain: 'ethereum',
        });
      }

      for (const token of snapshot.chains.ethereum.tokenBalances) {
        if (token.valueUsd && token.valueUsd > 0) {
          const existing = exposureMap.get(token.symbol);
          if (existing) {
            existing.valueUsd += token.valueUsd;
          } else {
            exposureMap.set(token.symbol, {
              valueUsd: token.valueUsd,
              chain: 'ethereum',
            });
          }
        }
      }
    }

    if (snapshot.chains.solana.isConnected) {
      const solBalance = snapshot.chains.solana.nativeBalance;
      if (solBalance.valueUsd && solBalance.valueUsd > 0) {
        exposureMap.set('SOL', {
          valueUsd: solBalance.valueUsd,
          chain: 'solana',
        });
      }

      for (const token of snapshot.chains.solana.tokenBalances) {
        if (token.valueUsd && token.valueUsd > 0) {
          const existing = exposureMap.get(token.symbol);
          if (existing) {
            existing.valueUsd += token.valueUsd;
          } else {
            exposureMap.set(token.symbol, {
              valueUsd: token.valueUsd,
              chain: 'solana',
            });
          }
        }
      }
    }

    // Convert to array and calculate percentages
    const total = snapshot.totalValueUsd || 1;
    const exposure = Array.from(exposureMap.entries())
      .map(([asset, data]) => ({
        asset,
        valueUsd: data.valueUsd,
        percentage: Math.round((data.valueUsd / total) * 100),
        chain: data.chain,
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    return exposure;
  }

  /**
   * Get combined USD value across all chains
   */
  async getTotalValueUsd(params: {
    ethereumAddress?: string;
    solanaAddress?: string;
  }): Promise<number> {
    const snapshot = await this.getPortfolioSnapshot(params);
    return snapshot.totalValueUsd;
  }

  // Private helper methods

  private emptyChainBalances(chain: ChainId, network: NetworkId = 'sepolia'): ChainBalances {
    return {
      chain,
      network: chain === 'solana' ? 'devnet' : network,
      nativeBalance: {
        chain,
        network: chain === 'solana' ? 'devnet' : network,
        symbol: chain === 'ethereum' ? 'ETH' : 'SOL',
        address: '',
        balance: '0',
        uiBalance: 0,
        decimals: chain === 'ethereum' ? 18 : 9,
        priceUsd: null,
        valueUsd: null,
      },
      tokenBalances: [],
      totalValueUsd: 0,
      isConnected: false,
      lastUpdated: Date.now(),
    };
  }

  private async ethRpcCall(method: string, params: any[]): Promise<any> {
    if (!this.ethereumRpcUrl) {
      throw new Error('Ethereum RPC URL not configured');
    }

    const response = await fetch(this.ethereumRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result;
  }

  private async getErc20Balance(
    owner: string,
    tokenAddress: string
  ): Promise<{ balance: string; uiBalance: number } | null> {
    try {
      // ERC20 balanceOf function selector
      const functionSelector = '0x70a08231';
      const paddedOwner = owner.toLowerCase().replace('0x', '').padStart(64, '0');
      const callData = functionSelector + paddedOwner;

      const result = await this.ethRpcCall('eth_call', [
        { to: tokenAddress, data: callData },
        'latest',
      ]);

      const balanceBigInt = BigInt(result);
      // Assume 6 decimals for USDC, 18 for WETH - would need token metadata in production
      const decimals = tokenAddress.toLowerCase().includes('weth') ? 18 : 6;
      const uiBalance = Number(balanceBigInt) / Math.pow(10, decimals);

      return {
        balance: balanceBigInt.toString(),
        uiBalance,
      };
    } catch (error) {
      console.warn(`[crossChainPortfolio] Failed to get ERC20 balance for ${tokenAddress}:`, error);
      return null;
    }
  }
}

/**
 * Create a cross-chain portfolio service instance
 */
export function createCrossChainPortfolioService(config?: {
  ethereumRpcUrl?: string;
  solanaRpcUrl?: string;
  ethereumChainId?: number;
}): CrossChainPortfolioService {
  return new CrossChainPortfolioService(config);
}

export default CrossChainPortfolioService;
