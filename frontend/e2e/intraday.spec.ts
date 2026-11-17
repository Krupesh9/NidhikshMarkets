import {test,expect} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
async function setup(page:any,context:any,mode='market'){
 const file=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');const auth=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:file.match(/Username: (.+)/)![1],password:file.match(/Password: (.+)/)![1]}});expect(auth.ok()).toBeTruthy();
 const settings=await(await context.request.get('/api/settings')).json();settings.workspace={...settings.workspace,symbol:'NVDA',mode,theme:'auto',price_feed:'delayed_sip'};
 await page.route('**/api/settings', (route:any)=>route.fulfill({json:settings}));await page.route('**/api/settings/workspace',(route:any)=>route.fulfill({json:JSON.parse(route.request().postData()||'{}')}));
}
function fixture(status='open',paused=false){return {configured:true,session:{status},budget:{paused,resume_at:paused?'2026-11-18T00:00:00Z':null},refresh_interval_seconds:60,feeds:{delayed_sip:{status:'cached',items:{NVDA:{price:110,change_percent:10,as_of:'2026-11-17T15:44:00Z',status:'cached'}}},iex:{status:'cached',items:{NVDA:{price:111.11,change_percent:11.11,as_of:'2026-11-17T15:59:50Z',status:'cached'}}}}};}
test('one newest price is selected automatically and theme follows the session',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,context);let status='open',paused=false,requests=0;
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status}}));
 await page.route('**/api/quotes/intraday?mode=market',route=>route.fulfill({json:fixture(status,paused)}));
 await page.route('**/api/admin/quotes/intraday/refresh',route=>{requests++;return route.fulfill({json:fixture(status,paused)});});
 await page.clock.install({time:new Date('2026-11-17T16:00:00Z')});await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
 await expect(page.locator('.quote-row .price')).toHaveText('$111.11');await expect(page.getByRole('tablist',{name:'Price feed'})).toHaveCount(0);await expect(page.locator('.intraday-prices')).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 const info=page.locator('.quote-row').getByRole('button',{name:'NVDA price information'});await info.hover();await expect(page.getByRole('tooltip')).toContainText('limited exchange coverage');await expect(page.getByRole('tooltip')).toContainText('Price time:');await info.focus();await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
 const nvda=page.locator('.ticker-entry').filter({has:page.locator('.ticker-row strong',{hasText:/^NVDA$/})});await expect(nvda.locator('.ticker-price b')).toHaveText('$111.11');await nvda.getByRole('button',{name:'NVDA price information'}).hover();await expect(page.getByRole('tooltip')).toContainText('limited exchange coverage');await expect(page.locator('.chart-readout')).toContainText('Daily OHLCV');
 await page.clock.runFor(500);const before=requests;status='closed';await page.clock.fastForward(30001);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.clock.fastForward(60001);expect(requests).toBe(before);
 status='open';paused=true;await page.clock.fastForward(30001);await expect(page.locator('html')).toHaveAttribute('data-theme','light');await info.hover();await expect(page.getByRole('tooltip')).toContainText('Updates paused until');expect(requests).toBe(before);expect(errors).toEqual([]);
});

test('falls back by event timestamp, ignoring invalid quotes and showing delays through the information icon',async({page,context})=>{
 await setup(page,context);let data:any=fixture('closed');
 const daily={symbol:'NVDA',name:'NVIDIA Corporation',price:105,change_percent:5,type:'daily_close',freshness:{as_of:'2026-11-16T21:00:00Z',status:'cached'}};
 await page.route('**/api/instruments/NVDA/quote?mode=market',route=>route.fulfill({json:daily}));
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status:'closed'}}));
 await page.route('**/api/quotes/intraday?mode=market',route=>route.fulfill({json:data}));
 await page.clock.install({time:new Date('2026-11-17T16:00:00Z')});
 async function assertPrice(price:string,note:string){await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();await expect(page.locator('.quote-row .price')).toHaveText(price);await page.locator('.quote-row').getByRole('button',{name:'NVDA price information'}).hover();await expect(page.getByRole('tooltip')).toContainText(note);}
 data.feeds.iex.items.NVDA.as_of='2026-11-16T20:00:00Z';await assertPrice('$110.00','15–16 minutes delayed');
 // A fetched snapshot must not outrank a newer completed daily close.
 data.feeds.delayed_sip.items.NVDA.as_of='2026-11-16T20:30:00Z';await assertPrice('$105.00','Last completed daily close');
 // Invalid and future event timestamps are not latest prices.
 data.feeds.delayed_sip.items.NVDA.as_of='invalid';data.feeds.iex.items.NVDA.price=-1;await assertPrice('$105.00','Last completed daily close');
 data.feeds.iex.items.NVDA={price:999,as_of:'2099-01-01T00:00:00Z'};await assertPrice('$105.00','Last completed daily close');
 data.feeds.iex.items.NVDA={price:111,as_of:'2026-11-17T15:44:00Z'};data.feeds.delayed_sip.items.NVDA={price:110,as_of:'2026-11-17T15:44:00Z'};await assertPrice('$110.00','15–16 minutes delayed');
 data.configured=false;await assertPrice('$105.00','Last completed daily close');
});

test('retains the newest shared cache when a provider refresh fails',async({page,context})=>{
 await setup(page,context);await page.clock.install({time:new Date('2026-11-17T16:00:00Z')});
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status:'open'}}));
 await page.route('**/api/quotes/intraday?mode=market',route=>route.fulfill({json:fixture()}));
 await page.route('**/api/admin/quotes/intraday/refresh',route=>route.fulfill({status:503,json:{detail:'Temporary refresh failure'}}));
 await page.goto('/');await expect(page.locator('.quote-row .price')).toHaveText('$111.11');await page.locator('.quote-row').getByRole('button',{name:'NVDA price information'}).hover();await expect(page.getByRole('tooltip')).toContainText('Refresh unavailable · cached price retained.');
});

test('synthetic search does not reuse real prices from the instrument directory',async({page,context})=>{
 await setup(page,context,'demo');
 await page.route('**/api/instruments/search?q=*',route=>route.fulfill({json:[{symbol:'UNSEEN',name:'Directory-only company',price:999.99,change_percent:25,cached:true}]}));
 await page.goto('/');await page.getByRole('button',{name:'Search symbols & actions'}).click();await page.getByLabel('Command search').fill('UNSEEN');
 const result=page.locator('.command-results');await expect(result).toContainText('Directory-only company');await expect(result).not.toContainText('$999.99');await expect(result).toContainText('Cached instrument');
});
