import LeumiBaseScraper from './base-leumi';
import { type ScraperScrapingResult } from './interface';
import { TRADE_APP_URL, fetchSecuritiesAccounts } from './leumi-trade-endpoints';

class LeumiTradeScraper extends LeumiBaseScraper {
  async fetchData(): Promise<ScraperScrapingResult> {
    await this.navigateTo(TRADE_APP_URL);

    const securitiesAccounts = await fetchSecuritiesAccounts(this.page, this.options);

    return {
      success: true,
      securitiesAccounts,
    };
  }
}

export default LeumiTradeScraper;
