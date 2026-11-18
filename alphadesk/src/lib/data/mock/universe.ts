import type { GicsSector } from '../types';

export interface MockCompany {
  ticker: string;
  name: string;
  sector: GicsSector;
  industry: string;
  country: string;
  exchange: string;
  /** reference price (USD) */
  price: number;
  /** market cap, $bn */
  mcapB: number;
  pe: number;
  evEbitda: number;
  /** TTM revenue, $bn */
  revB: number;
  /** YoY revenue growth % */
  revGrowth: number;
  /** net margin % */
  netMargin: number;
  founded: number;
  /** first year of public financials in mock history */
  ipo: number;
  hq: string;
  ceo: string;
  employeesK: number;
  beta: number;
  divYield: number;
  esg: number;
  shortInt: number;
  website: string;
}

const c = (
  ticker: string, name: string, sector: GicsSector, industry: string, country: string, exchange: string,
  price: number, mcapB: number, pe: number, evEbitda: number, revB: number, revGrowth: number, netMargin: number,
  founded: number, ipo: number, hq: string, ceo: string, employeesK: number, beta: number, divYield: number,
  esg: number, shortInt: number, website: string,
): MockCompany => ({ ticker, name, sector, industry, country, exchange, price, mcapB, pe, evEbitda, revB, revGrowth, netMargin, founded, ipo, hq, ceo, employeesK, beta, divYield, esg, shortInt, website });

const IT: GicsSector = 'Information Technology';
const CS: GicsSector = 'Communication Services';
const CD: GicsSector = 'Consumer Discretionary';
const ST: GicsSector = 'Consumer Staples';
const EN: GicsSector = 'Energy';
const FN: GicsSector = 'Financials';
const HC: GicsSector = 'Health Care';
const IN: GicsSector = 'Industrials';
const MT: GicsSector = 'Materials';
const RE: GicsSector = 'Real Estate';
const UT: GicsSector = 'Utilities';

/** 50 large/mid caps across all 11 GICS sectors. Figures are illustrative mock values. */
export const MOCK_UNIVERSE: MockCompany[] = [
  c('AAPL', 'Apple Inc.', IT, 'Technology Hardware', 'US', 'NASDAQ', 268.4, 3990, 33.1, 25.4, 416, 6.4, 26.9, 1976, 1980, 'Cupertino, CA', 'Tim Cook', 164, 1.18, 0.4, 72, 0.8, 'apple.com'),
  c('MSFT', 'Microsoft Corporation', IT, 'Systems Software', 'US', 'NASDAQ', 507.2, 3770, 35.8, 24.1, 293, 15.6, 36.1, 1975, 1986, 'Redmond, WA', 'Satya Nadella', 228, 0.92, 0.7, 78, 0.6, 'microsoft.com'),
  c('NVDA', 'NVIDIA Corporation', IT, 'Semiconductors', 'US', 'NASDAQ', 186.5, 4540, 45.2, 37.8, 187, 62.5, 55.6, 1993, 1999, 'Santa Clara, CA', 'Jensen Huang', 36, 1.72, 0.02, 69, 1.0, 'nvidia.com'),
  c('AVGO', 'Broadcom Inc.', IT, 'Semiconductors', 'US', 'NASDAQ', 342.1, 1610, 38.4, 30.2, 63.9, 28.1, 36.2, 1961, 2009, 'Palo Alto, CA', 'Hock Tan', 37, 1.21, 0.7, 61, 1.4, 'broadcom.com'),
  c('ORCL', 'Oracle Corporation', IT, 'Application Software', 'US', 'NYSE', 228.9, 650, 34.2, 25.9, 59.0, 12.2, 21.7, 1977, 1986, 'Austin, TX', 'Safra Catz', 159, 1.05, 0.9, 58, 1.6, 'oracle.com'),
  c('CRM', 'Salesforce, Inc.', IT, 'Application Software', 'US', 'NYSE', 242.6, 232, 26.3, 18.4, 39.5, 8.7, 16.4, 1999, 2004, 'San Francisco, CA', 'Marc Benioff', 76, 1.16, 0.7, 74, 1.3, 'salesforce.com'),
  c('AMD', 'Advanced Micro Devices, Inc.', IT, 'Semiconductors', 'US', 'NASDAQ', 248.3, 403, 52.6, 41.3, 31.0, 31.7, 9.8, 1969, 1979, 'Santa Clara, CA', 'Lisa Su', 28, 1.88, 0, 66, 2.2, 'amd.com'),
  c('ADBE', 'Adobe Inc.', IT, 'Application Software', 'US', 'NASDAQ', 338.7, 143, 20.5, 16.7, 23.5, 10.6, 30.0, 1982, 1986, 'San Jose, CA', 'Shantanu Narayen', 30, 1.24, 0, 76, 2.1, 'adobe.com'),
  c('TSM', 'Taiwan Semiconductor Manufacturing Co.', IT, 'Semiconductors', 'TW', 'NYSE', 296.4, 1540, 26.8, 15.2, 113, 37.4, 43.1, 1987, 1997, 'Hsinchu, Taiwan', 'C.C. Wei', 83, 1.24, 1.1, 71, 0.5, 'tsmc.com'),

  c('GOOGL', 'Alphabet Inc.', CS, 'Interactive Media & Services', 'US', 'NASDAQ', 284.1, 3430, 27.4, 20.3, 385, 13.9, 32.2, 1998, 2004, 'Mountain View, CA', 'Sundar Pichai', 187, 1.02, 0.3, 67, 0.9, 'abc.xyz'),
  c('META', 'Meta Platforms, Inc.', CS, 'Interactive Media & Services', 'US', 'NASDAQ', 612.8, 1540, 23.9, 15.8, 189, 21.6, 37.9, 2004, 2012, 'Menlo Park, CA', 'Mark Zuckerberg', 76, 1.25, 0.3, 54, 1.1, 'meta.com'),
  c('NFLX', 'Netflix, Inc.', CS, 'Movies & Entertainment', 'US', 'NASDAQ', 112.6, 478, 44.7, 33.5, 44.1, 16.2, 24.6, 1997, 2002, 'Los Gatos, CA', 'Ted Sarandos', 14, 1.31, 0, 63, 1.8, 'netflix.com'),
  c('DIS', 'The Walt Disney Company', CS, 'Movies & Entertainment', 'US', 'NYSE', 111.9, 202, 17.2, 12.4, 94.4, 3.6, 12.1, 1923, 1957, 'Burbank, CA', 'Bob Iger', 233, 1.38, 0.9, 70, 1.0, 'thewaltdisneycompany.com'),
  c('TMUS', 'T-Mobile US, Inc.', CS, 'Wireless Telecom', 'US', 'NASDAQ', 214.5, 241, 20.1, 10.8, 86.2, 6.1, 14.3, 1994, 2007, 'Bellevue, WA', 'Srini Gopalan', 70, 0.58, 1.7, 62, 1.5, 't-mobile.com'),

  c('AMZN', 'Amazon.com, Inc.', CD, 'Broadline Retail', 'US', 'NASDAQ', 236.9, 2530, 33.6, 17.9, 691, 11.4, 10.8, 1994, 1997, 'Seattle, WA', 'Andy Jassy', 1556, 1.31, 0, 59, 0.8, 'amazon.com'),
  c('TSLA', 'Tesla, Inc.', CD, 'Automobile Manufacturers', 'US', 'NASDAQ', 402.7, 1340, 182.4, 98.3, 95.6, -1.6, 6.3, 2003, 2010, 'Austin, TX', 'Elon Musk', 125, 2.31, 0, 52, 2.9, 'tesla.com'),
  c('HD', 'The Home Depot, Inc.', CD, 'Home Improvement Retail', 'US', 'NYSE', 379.4, 377, 25.8, 17.6, 164, 4.1, 9.1, 1978, 1981, 'Atlanta, GA', 'Ted Decker', 470, 1.02, 2.4, 68, 0.9, 'homedepot.com'),
  c('MCD', "McDonald's Corporation", CD, 'Restaurants', 'US', 'NYSE', 302.1, 216, 25.9, 19.1, 26.1, 2.8, 31.8, 1940, 1966, 'Chicago, IL', 'Chris Kempczinski', 150, 0.62, 2.4, 57, 1.1, 'mcdonalds.com'),

  c('PG', 'The Procter & Gamble Company', ST, 'Household Products', 'US', 'NYSE', 151.3, 354, 23.4, 16.6, 84.9, 1.7, 18.9, 1837, 1950, 'Cincinnati, OH', 'Shailesh Jejurikar', 108, 0.41, 2.8, 79, 0.7, 'pg.com'),
  c('KO', 'The Coca-Cola Company', ST, 'Soft Drinks & Non-alcoholic Beverages', 'US', 'NYSE', 69.8, 300, 23.1, 21.4, 47.4, 3.2, 27.3, 1886, 1919, 'Atlanta, GA', 'James Quincey', 69, 0.47, 2.9, 75, 0.8, 'coca-colacompany.com'),
  c('COST', 'Costco Wholesale Corporation', ST, 'Consumer Staples Merchandise Retail', 'US', 'NASDAQ', 918.5, 407, 50.3, 32.6, 275, 8.1, 2.9, 1983, 1985, 'Issaquah, WA', 'Ron Vachris', 341, 0.79, 0.6, 72, 1.0, 'costco.com'),
  c('WMT', 'Walmart Inc.', ST, 'Consumer Staples Merchandise Retail', 'US', 'NASDAQ', 103.4, 825, 38.6, 21.5, 693, 4.6, 2.9, 1962, 1972, 'Bentonville, AR', 'Doug McMillon', 2100, 0.52, 0.9, 64, 0.6, 'walmart.com'),

  c('XOM', 'Exxon Mobil Corporation', EN, 'Integrated Oil & Gas', 'US', 'NYSE', 116.2, 495, 16.4, 7.6, 332, -3.8, 9.1, 1870, 1920, 'Spring, TX', 'Darren Woods', 61, 0.74, 3.4, 41, 1.1, 'corporate.exxonmobil.com'),
  c('CVX', 'Chevron Corporation', EN, 'Integrated Oil & Gas', 'US', 'NYSE', 153.8, 307, 19.7, 8.1, 189, -4.6, 7.3, 1879, 1921, 'Houston, TX', 'Mike Wirth', 45, 0.81, 4.5, 43, 1.4, 'chevron.com'),
  c('SLB', 'SLB N.V.', EN, 'Oil & Gas Equipment & Services', 'US', 'NYSE', 35.6, 53, 12.4, 7.2, 35.4, -2.1, 11.5, 1926, 1962, 'Houston, TX', 'Olivier Le Peuch', 110, 1.12, 3.2, 58, 2.6, 'slb.com'),

  c('JPM', 'JPMorgan Chase & Co.', FN, 'Diversified Banks', 'US', 'NYSE', 309.7, 845, 15.6, 0, 182, 5.2, 31.4, 1799, 1969, 'New York, NY', 'Jamie Dimon', 318, 1.08, 1.9, 60, 0.8, 'jpmorganchase.com'),
  c('BAC', 'Bank of America Corporation', FN, 'Diversified Banks', 'US', 'NYSE', 52.4, 393, 14.2, 0, 104, 6.0, 27.6, 1904, 1974, 'Charlotte, NC', 'Brian Moynihan', 213, 1.29, 2.1, 59, 1.0, 'bankofamerica.com'),
  c('GS', 'The Goldman Sachs Group, Inc.', FN, 'Investment Banking & Brokerage', 'US', 'NYSE', 781.3, 238, 16.9, 0, 57.3, 9.4, 26.1, 1869, 1999, 'New York, NY', 'David Solomon', 46, 1.37, 1.6, 57, 1.3, 'goldmansachs.com'),
  c('V', 'Visa Inc.', FN, 'Transaction & Payment Processing', 'US', 'NYSE', 344.8, 667, 32.7, 25.6, 40.0, 11.3, 52.2, 1958, 2008, 'San Francisco, CA', 'Ryan McInerney', 31, 0.94, 0.7, 73, 1.2, 'visa.com'),
  c('MA', 'Mastercard Incorporated', FN, 'Transaction & Payment Processing', 'US', 'NYSE', 566.1, 515, 37.4, 28.7, 31.5, 13.1, 45.5, 1966, 2006, 'Purchase, NY', 'Michael Miebach', 35, 1.03, 0.5, 74, 0.9, 'mastercard.com'),

  c('LLY', 'Eli Lilly and Company', HC, 'Pharmaceuticals', 'US', 'NYSE', 932.4, 836, 44.9, 33.1, 59.4, 45.5, 31.6, 1876, 1970, 'Indianapolis, IN', 'David Ricks', 47, 0.44, 0.6, 69, 0.9, 'lilly.com'),
  c('UNH', 'UnitedHealth Group Incorporated', HC, 'Managed Health Care', 'US', 'NYSE', 331.6, 300, 17.6, 12.3, 435, 11.8, 3.6, 1977, 1984, 'Eden Prairie, MN', 'Stephen Hemsley', 400, 0.53, 2.7, 56, 1.6, 'unitedhealthgroup.com'),
  c('JNJ', 'Johnson & Johnson', HC, 'Pharmaceuticals', 'US', 'NYSE', 194.7, 469, 18.8, 14.2, 92.1, 5.1, 22.4, 1886, 1944, 'New Brunswick, NJ', 'Joaquin Duato', 138, 0.41, 2.7, 71, 0.6, 'jnj.com'),
  c('MRK', 'Merck & Co., Inc.', HC, 'Pharmaceuticals', 'US', 'NYSE', 88.3, 221, 11.3, 8.9, 64.2, 1.8, 28.4, 1891, 1946, 'Rahway, NJ', 'Rob Davis', 74, 0.38, 3.7, 70, 1.3, 'merck.com'),
  c('ABBV', 'AbbVie Inc.', HC, 'Biotechnology', 'US', 'NYSE', 226.5, 400, 21.6, 15.4, 59.6, 7.4, 13.1, 2013, 2013, 'North Chicago, IL', 'Rob Michael', 55, 0.53, 2.9, 64, 0.8, 'abbvie.com'),
  c('ISRG', 'Intuitive Surgical, Inc.', HC, 'Health Care Equipment', 'US', 'NASDAQ', 538.2, 193, 70.4, 52.6, 9.6, 21.0, 28.9, 1995, 2000, 'Sunnyvale, CA', 'Dave Rosa', 16, 1.14, 0, 74, 1.1, 'intuitive.com'),
  c('NVO', 'Novo Nordisk A/S', HC, 'Pharmaceuticals', 'DK', 'NYSE', 49.6, 221, 13.4, 9.8, 47.3, 12.8, 34.6, 1923, 1981, 'Bagsvaerd, Denmark', 'Mike Doustdar', 78, 0.36, 3.1, 77, 0.7, 'novonordisk.com'),

  c('CAT', 'Caterpillar Inc.', IN, 'Construction Machinery', 'US', 'NYSE', 561.4, 263, 28.5, 19.2, 63.4, 1.2, 15.6, 1925, 1929, 'Irving, TX', 'Joe Creed', 113, 1.12, 1.1, 61, 1.5, 'caterpillar.com'),
  c('GE', 'GE Aerospace', IN, 'Aerospace & Defense', 'US', 'NYSE', 301.8, 320, 41.2, 30.4, 43.9, 18.6, 18.7, 1892, 1962, 'Evendale, OH', 'Larry Culp', 53, 1.22, 0.5, 63, 0.9, 'geaerospace.com'),
  c('HON', 'Honeywell International Inc.', IN, 'Industrial Conglomerates', 'US', 'NASDAQ', 201.6, 128, 21.7, 15.3, 40.6, 6.3, 14.9, 1906, 1970, 'Charlotte, NC', 'Vimal Kapur', 102, 0.98, 2.3, 66, 1.2, 'honeywell.com'),
  c('UNP', 'Union Pacific Corporation', IN, 'Rail Transportation', 'US', 'NYSE', 229.3, 136, 19.8, 13.6, 24.5, 1.8, 28.4, 1862, 1980, 'Omaha, NE', 'Jim Vena', 30, 1.04, 2.4, 62, 1.0, 'up.com'),
  c('LMT', 'Lockheed Martin Corporation', IN, 'Aerospace & Defense', 'US', 'NYSE', 472.9, 110, 26.4, 16.1, 73.3, 3.4, 5.9, 1995, 1995, 'Bethesda, MD', 'Jim Taiclet', 121, 0.32, 2.8, 49, 1.3, 'lockheedmartin.com'),

  c('LIN', 'Linde plc', MT, 'Industrial Gases', 'US', 'NASDAQ', 428.5, 201, 30.1, 18.6, 33.4, 1.9, 20.1, 1879, 1992, 'Woking, UK', 'Sanjiv Lamba', 66, 0.88, 1.4, 76, 0.7, 'linde.com'),
  c('FCX', 'Freeport-McMoRan Inc.', MT, 'Copper', 'US', 'NYSE', 43.1, 62, 31.2, 7.9, 26.0, 4.7, 7.6, 1987, 1995, 'Phoenix, AZ', 'Kathleen Quirk', 28, 1.63, 1.4, 52, 1.9, 'fcx.com'),
  c('NEM', 'Newmont Corporation', MT, 'Gold', 'US', 'NYSE', 86.4, 95, 13.8, 7.1, 21.4, 31.2, 28.8, 1921, 1940, 'Denver, CO', 'Natascha Viljoen', 22, 0.49, 1.2, 60, 1.4, 'newmont.com'),

  c('PLD', 'Prologis, Inc.', RE, 'Industrial REITs', 'US', 'NYSE', 124.7, 116, 34.6, 24.1, 8.6, 6.8, 39.2, 1983, 1994, 'San Francisco, CA', 'Hamid Moghadam', 2.7, 1.07, 3.3, 72, 1.0, 'prologis.com'),
  c('AMT', 'American Tower Corporation', RE, 'Telecom Tower REITs', 'US', 'NYSE', 182.3, 85, 30.8, 19.4, 10.3, 2.4, 22.6, 1995, 1998, 'Boston, MA', 'Steven Vondran', 4.7, 0.86, 3.7, 66, 1.4, 'americantower.com'),
  c('EQIX', 'Equinix, Inc.', RE, 'Data Center REITs', 'US', 'NASDAQ', 812.6, 79, 62.3, 22.7, 9.2, 6.1, 13.9, 1998, 2000, 'Redwood City, CA', 'Adaire Fox-Martin', 13, 0.79, 2.3, 74, 1.5, 'equinix.com'),

  c('NEE', 'NextEra Energy, Inc.', UT, 'Electric Utilities', 'US', 'NYSE', 82.6, 170, 26.2, 15.8, 26.8, 8.9, 25.1, 1925, 1950, 'Juno Beach, FL', 'John Ketchum', 17, 0.61, 2.8, 70, 1.3, 'nexteraenergy.com'),
  c('DUK', 'Duke Energy Corporation', UT, 'Electric Utilities', 'US', 'NYSE', 124.1, 96, 20.1, 12.4, 31.4, 3.6, 15.0, 1904, 1961, 'Charlotte, NC', 'Harry Sideris', 27, 0.45, 3.4, 58, 1.0, 'duke-energy.com'),
];

export const MOCK_BY_TICKER: Record<string, MockCompany> = Object.fromEntries(MOCK_UNIVERSE.map((m) => [m.ticker, m]));
