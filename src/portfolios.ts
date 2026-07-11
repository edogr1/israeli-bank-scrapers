export interface SecurityHolding {
  /**
   * ticker / display symbol; for TASE papers this may be the paper number
   */
  symbol: string;
  /**
   * ISIN or TASE security number when available
   */
  securityId?: string;
  name: string;
  quantity: number;
  lastPrice?: number;
  priceCurrency?: string;
  marketValue: number;
  valueCurrency: string;
  /**
   * total cost of the position, in the same currency as `marketValue`
   */
  costBasis?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  dailyChangePercent?: number;
  monthlyChangePercent?: number;
  /**
   * the weight of this holding in the portfolio, in percent
   */
  weightPercent?: number;
  /**
   * the raw holding object as received from the scraper source, for debugging purposes.
   * included only when `includeRawTransaction` option is enabled
   */
  raw?: unknown;
}

export interface SecuritiesAccount {
  accountNumber: string;
  totalValue?: number;
  /**
   * total cost of the positions in the portfolio
   */
  totalCost?: number;
  /**
   * cash balance available alongside the portfolio (e.g. the linked current account)
   */
  cashBalance?: number;
  /**
   * maximum available amount for buying securities
   */
  buyingPower?: number;
  currency?: string;
  dailyChange?: number;
  dailyChangePercent?: number;
  monthlyChange?: number;
  monthlyChangePercent?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  /**
   * ISO date string of the snapshot
   */
  balanceDate?: string;
  holdings: SecurityHolding[];
}
