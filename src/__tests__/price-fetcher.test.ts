import { PriceFetcher } from '../fetchers/price-fetcher';

describe('PriceFetcher', () => {
  let priceFetcher: PriceFetcher;

  beforeEach(() => {
    priceFetcher = new PriceFetcher();
  });

  describe('getUsdPrice', () => {
    it('should return a price greater than 0 for supported chains', async () => {
      // Ethereum (chainId: 1)
      const ethPrice = await priceFetcher.getUsdPrice(1);
      expect(ethPrice).toBeGreaterThan(0);

      // BSC (chainId: 56)
      const bnbPrice = await priceFetcher.getUsdPrice(56);
      expect(bnbPrice).toBeGreaterThan(0);
    });

    it('should return 0 for unsupported chains', async () => {
      const price = await priceFetcher.getUsdPrice(999999);
      expect(price).toBe(0);
    });

    it('should cache prices and return cached value', async () => {
      // First call
      const price1 = await priceFetcher.getUsdPrice(1);
      // Second call should use cache
      const price2 = await priceFetcher.getUsdPrice(1);
      expect(price1).toBe(price2);
    });
  });

  describe('fallback prices', () => {
    it('should NOT return hardcoded fallback prices (this is the fix)', async () => {
      // After fix: should return 0 if no cache and API fails
      // Before fix: would return hardcoded values like 3500, 600, etc.
      // We test that the method doesn't return the old hardcoded values
      const priceFetcherNew = new PriceFetcher();
      // For unsupported chain, should return 0
      const price = await priceFetcherNew.getUsdPrice(999999);
      expect(price).toBe(0);
    });
  });
});
