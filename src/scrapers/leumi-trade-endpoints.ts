import moment from 'moment';
import { type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { getDebug } from '../helpers/debug';
import { fetchGetWithinPage } from '../helpers/fetch';
import { waitUntil } from '../helpers/waiting';
import { type SecuritiesAccount, type SecurityHolding } from '../portfolios';
import { BASE_URL } from './base-leumi';
import { type ScraperOptions } from './interface';

// This module is the only place that knows the Leumi Trade (LTI) urls, request
// parameters and raw response shapes, so that changes on the bank side are
// isolated from the scraper flow in leumi-trade.ts.
//
// The LTI app lives on the same host and session as the regular bank site.
// All endpoints are plain GET requests authenticated by the session cookies,
// returning a `{ data, resultCode, errorMessage }` envelope.

const debug = getDebug('leumi-trade');

export const TRADE_APP_URL = `${BASE_URL}/lti/lti-app/home`;
const API_BASE_URL = `${BASE_URL}/lti/lti-app/api`;

// region 0 is the local (TASE) market where rates are denominated in agorot;
// other regions are foreign markets where rates are in the paper's native currency
const TASE_REGION_ID = 0;
const AGOROT_PER_SHEKEL = 100;

interface LtiEnvelope<TData> {
  data: TData;
  resultCode: number;
  errorMessage?: string;
}

export interface RawPortfolio {
  Branch: number | string;
  Pikadon: number | string;
  PFCost: number;
  PFValue: number;
  PLShekel: number;
  PLPercent: number;
  DailyChangePercent: number;
  ValidToDateTime: string;
  PortfolioIndex: number;
  PortfolioId: number | string;
  PortfolioName: string;
}

export interface RawHolding {
  PaperId: number;
  PaperName: string;
  Symbol: string;
  ChangePercent: number | null;
  PaperTypeName: string;
  AverageRate: number;
  Amount: number;
  Value: number;
  ProfitCash: number;
  ProfitPercent: number;
  Percent: number;
  RegionID: number;
  CurrencyRate: number;
  PaperLastRateForStatement: number;
}

export interface RawUserStatement {
  maxDateChange: string;
  PortfolioValue: number;
  SumCost: number;
  DailyChangePercent: number;
  SumDailyProfit: number;
  SumProfitCash: number;
  SumProfitPercent: number;
  ReportDate: string;
  PortfolioLimitValue: number;
  PortfolioMatiValue: number;
  DataSource: RawHolding[];
}

function ratesToCurrency(rate: number, regionId: number): number {
  return regionId === TASE_REGION_ID ? rate / AGOROT_PER_SHEKEL : rate;
}

export function mapHolding(rawHolding: RawHolding, options?: ScraperOptions): SecurityHolding {
  const holding: SecurityHolding = {
    symbol: rawHolding.Symbol || String(rawHolding.PaperId),
    securityId: String(rawHolding.PaperId),
    name: rawHolding.PaperName,
    quantity: rawHolding.Amount,
    lastPrice: ratesToCurrency(rawHolding.PaperLastRateForStatement, rawHolding.RegionID),
    priceCurrency: rawHolding.RegionID === TASE_REGION_ID ? SHEKEL_CURRENCY : undefined,
    marketValue: rawHolding.Value,
    valueCurrency: SHEKEL_CURRENCY,
    // ProfitCash is always denominated in shekels, so the cost derived from it is too
    costBasis: rawHolding.Value - rawHolding.ProfitCash,
    unrealizedPnl: rawHolding.ProfitCash,
    unrealizedPnlPercent: rawHolding.ProfitPercent,
    dailyChangePercent: rawHolding.ChangePercent ?? undefined,
    weightPercent: rawHolding.Percent,
  };

  if (options?.includeRawTransaction) {
    holding.raw = rawHolding;
  }

  return holding;
}

export function mapSecuritiesAccount(
  rawPortfolio: RawPortfolio,
  rawStatement: RawUserStatement,
  options?: ScraperOptions,
): SecuritiesAccount {
  const balanceDate = rawStatement.maxDateChange || rawStatement.ReportDate;
  return {
    accountNumber: rawPortfolio.PortfolioName,
    totalValue: rawStatement.PortfolioValue,
    totalCost: rawStatement.SumCost,
    cashBalance: rawStatement.PortfolioMatiValue,
    buyingPower: rawStatement.PortfolioLimitValue,
    currency: SHEKEL_CURRENCY,
    dailyChange: rawStatement.SumDailyProfit,
    dailyChangePercent: rawStatement.DailyChangePercent,
    unrealizedPnl: rawStatement.SumProfitCash,
    unrealizedPnlPercent: rawStatement.SumProfitPercent,
    balanceDate: balanceDate ? moment(balanceDate).milliseconds(0).toISOString() : undefined,
    holdings: (rawStatement.DataSource || []).map(rawHolding => mapHolding(rawHolding, options)),
  };
}

async function callTradeApi<TData>(page: Page, path: string, params: Record<string, string>): Promise<TData> {
  const url = `${API_BASE_URL}/${path}?${new URLSearchParams(params).toString()}`;
  const response = await fetchGetWithinPage<LtiEnvelope<TData>>(page, url);
  if (!response || response.resultCode !== 0) {
    throw new Error(`leumi trade api '${path}' failed: ${response?.errorMessage || 'empty response'}`);
  }
  return response.data;
}

function fetchPortfolios(page: Page): Promise<{ records: RawPortfolio[] }> {
  return callTradeApi<{ records: RawPortfolio[] }>(page, 'Trade/RikuzTikim', {
    AccountType: 'accountType',
    rt: 'false',
  });
}

function fetchStatement(page: Page, portfolioIndex: number): Promise<{ UserStatement: RawUserStatement }> {
  return callTradeApi<{ UserStatement: RawUserStatement }>(page, 'Trade/Statement', {
    PortfolioIndex: String(portfolioIndex),
    StatementType: 'Today',
    ViewDate: moment().format('YYYY-MM-DD'),
    ViewID: '7', // "my holdings" view
    SubView: '16',
    FromCache: 'false',
    AlwaysChangePercent: 'false',
    IsMain: 'false',
    RegionId: '-1',
    CurrencyCode: '0',
    rt: 'false',
  });
}

export async function fetchSecuritiesAccounts(page: Page, options: ScraperOptions): Promise<SecuritiesAccount[]> {
  debug('waiting for the trade app session to be ready');
  // the trade session is initialized server side while the app page loads, so
  // poll the portfolios endpoint until it responds successfully
  const portfolios = await waitUntil(
    () => fetchPortfolios(page).catch(() => null),
    'trade app session is ready',
    60000,
    2000,
  );

  debug(`fetching statements for ${portfolios.records.length} portfolios`);
  const accounts: SecuritiesAccount[] = [];
  for (const rawPortfolio of portfolios.records) {
    const statement = await fetchStatement(page, rawPortfolio.PortfolioIndex);
    accounts.push(mapSecuritiesAccount(rawPortfolio, statement.UserStatement, options));
  }

  return accounts;
}
