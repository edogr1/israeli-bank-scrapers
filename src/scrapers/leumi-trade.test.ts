import LeumiTradeScraper from './leumi-trade';
import {
  mapHolding,
  mapSecuritiesAccount,
  type RawHolding,
  type RawPortfolio,
  type RawUserStatement,
} from './leumi-trade-endpoints';
import { maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig } from '../tests/tests-utils';
import { SCRAPERS } from '../definitions';
import { LoginResults } from './base-scraper-with-browser';

const COMPANY_ID = 'leumiTrade'; // TODO this property should be hard-coded in the provider
const testsConfig = getTestsConfig();

// synthetic fixtures based on anonymized samples captured from the live api
const taseHolding: RawHolding = {
  PaperId: 1100001,
  PaperName: 'SOME LOCAL ETF',
  Symbol: 'SL.F1',
  ChangePercent: -0.27,
  PaperTypeName: 'קרן חוץ נסחרת',
  AverageRate: 30000,
  Amount: 100,
  Value: 36470, // Amount * PaperLastRateForStatement / 100 (rate is in agorot)
  ProfitCash: 6470,
  ProfitPercent: 21.57,
  Percent: 40,
  RegionID: 0,
  CurrencyRate: 1,
  PaperLastRateForStatement: 36470,
};

const foreignHolding: RawHolding = {
  PaperId: 2200002,
  PaperName: 'SOME US ETF',
  Symbol: 'SUE',
  ChangePercent: null,
  PaperTypeName: 'תעודות סל בניעז ETF',
  AverageRate: 200,
  Amount: 10,
  Value: 9018, // Amount * PaperLastRateForStatement * CurrencyRate
  ProfitCash: 3006,
  ProfitPercent: 50,
  Percent: 10,
  RegionID: 1,
  CurrencyRate: 3.006,
  PaperLastRateForStatement: 300,
};

const portfolio: RawPortfolio = {
  Branch: 800,
  Pikadon: 123456,
  PFCost: 40000,
  PFValue: 45488,
  PLShekel: 5488,
  PLPercent: 13.72,
  DailyChangePercent: -0.13,
  ValidToDateTime: '2026-07-10 14:19',
  PortfolioIndex: 0,
  PortfolioId: '80000000012345',
  PortfolioName: '800-001234/56',
};

const statement: RawUserStatement = {
  maxDateChange: '2026-07-10 13:57',
  PortfolioValue: 45488,
  SumCost: 39012,
  DailyChangePercent: -0.0813,
  SumDailyProfit: -101.8,
  SumProfitCash: 6476,
  SumProfitPercent: 16.6,
  ReportDate: '2026-07-10',
  PortfolioLimitValue: 7613.5,
  PortfolioMatiValue: 7578.8,
  DataSource: [taseHolding, foreignHolding],
};

describe('Leumi Trade scraper', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  test('should expose login fields in scrapers constant', () => {
    expect(SCRAPERS.leumiTrade).toBeDefined();
    expect(SCRAPERS.leumiTrade.loginFields).toContain('username');
    expect(SCRAPERS.leumiTrade.loginFields).toContain('password');
  });

  test('should map a TASE holding converting agorot rates to shekels', () => {
    const holding = mapHolding(taseHolding);

    expect(holding).toMatchObject({
      symbol: 'SL.F1',
      securityId: '1100001',
      name: 'SOME LOCAL ETF',
      quantity: 100,
      lastPrice: 364.7,
      priceCurrency: 'ILS',
      marketValue: 36470,
      valueCurrency: 'ILS',
      costBasis: 30000,
      unrealizedPnl: 6470,
      unrealizedPnlPercent: 21.57,
      dailyChangePercent: -0.27,
      weightPercent: 40,
    });
    expect(holding.raw).toBeUndefined();
  });

  test('should map a foreign holding keeping the native rate', () => {
    const holding = mapHolding(foreignHolding);

    expect(holding).toMatchObject({
      symbol: 'SUE',
      quantity: 10,
      lastPrice: 300,
      marketValue: 9018,
      valueCurrency: 'ILS',
      costBasis: 6012,
      unrealizedPnl: 3006,
    });
    expect(holding.priceCurrency).toBeUndefined();
    expect(holding.dailyChangePercent).toBeUndefined();
  });

  test('should include the raw holding when includeRawTransaction is enabled', () => {
    const holding = mapHolding(taseHolding, { includeRawTransaction: true } as any);
    expect(holding.raw).toBe(taseHolding);
  });

  test('should map the securities account from portfolio and statement', () => {
    const account = mapSecuritiesAccount(portfolio, statement);

    expect(account).toMatchObject({
      accountNumber: '800-001234/56',
      totalValue: 45488,
      totalCost: 39012,
      cashBalance: 7578.8,
      buyingPower: 7613.5,
      currency: 'ILS',
      dailyChange: -101.8,
      dailyChangePercent: -0.0813,
      unrealizedPnl: 6476,
      unrealizedPnlPercent: 16.6,
    });
    expect(account.balanceDate).toBe(new Date('2026-07-10T13:57:00').toISOString());
    expect(account.holdings).toHaveLength(2);
  });

  maybeTestCompanyAPI(COMPANY_ID, config => config.companyAPI.invalidPassword)(
    'should fail on invalid user/password"',
    async () => {
      const options = {
        ...testsConfig.options,
        companyId: COMPANY_ID,
      };

      const scraper = new LeumiTradeScraper(options);

      const result = await scraper.scrape({ username: 'e10s12', password: '3f3ss3d' });

      expect(result).toBeDefined();
      expect(result.success).toBeFalsy();
      expect(result.errorType).toBe(LoginResults.InvalidPassword);
    },
  );

  maybeTestCompanyAPI(COMPANY_ID)('should scrape securities accounts', async () => {
    const options = {
      ...testsConfig.options,
      companyId: COMPANY_ID,
    };

    const scraper = new LeumiTradeScraper(options);
    const result = await scraper.scrape(testsConfig.credentials.leumiTrade);
    expect(result).toBeDefined();
    const error = `${result.errorType || ''} ${result.errorMessage || ''}`.trim();
    expect(error).toBe('');
    expect(result.success).toBeTruthy();
    expect(result.securitiesAccounts).toBeDefined();
    expect(result.securitiesAccounts!.length).toBeGreaterThan(0);
    for (const account of result.securitiesAccounts!) {
      expect(account.accountNumber).toBeTruthy();
      expect(account.totalValue).toBeGreaterThan(0);
      for (const holding of account.holdings) {
        expect(holding.symbol).toBeTruthy();
        expect(holding.quantity).toBeGreaterThan(0);
        expect(holding.marketValue).toBeGreaterThan(0);
      }
    }
  });
});
