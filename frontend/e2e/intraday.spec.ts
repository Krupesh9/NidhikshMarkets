import {test,expect} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
async function setup(page:any,context:any){
 const file=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');const auth=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:file.match(/Username: (.+)/)![1],password:file.match(/Password: (.+)/)![1]}});expect(auth.ok()).toBeTruthy();
 const settings=await(await context.request.get('/api/settings')).json();settings.workspace={...settings.workspace,symbol:'NVDA',mode:'market',theme:'auto',price_feed:'delayed_sip'};
 await page.route('**/api/settings', (route:any)=>route.fulfill({json:settings}));await page.route('**/api/settings/workspace',(route:any)=>route.fulfill({json:JSON.parse(route.request().postData()||'{}')}));
}
function fixture(status='open',paused=false){return {configured:true,session:{status},budget:{paused,resume_at:paused?'2026-11-18T00:00:00Z':null},refresh_interval_seconds:60,feeds:{delayed_sip:{status:'cached',items:{NVDA:{price:110,change_percent:10,as_of:'2026-11-17T15:44:00Z',status:'cached'}}},iex:{status:'cached',items:{NVDA:{price:111.11,change_percent:11.11,as_of:'2026-11-17T15:59:50Z',status:'cached'}}}}};}
test('both price views remain distinct from daily charts and the theme follows session changes',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await setup(page,context);let status='open',paused=false,requests=0;
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status}}));
 await page.route('**/api/quotes/intraday?mode=market',route=>route.fulfill({json:fixture(status,paused)}));
 await page.route('**/api/admin/quotes/intraday/refresh',route=>{requests++;return route.fulfill({json:fixture(status,paused)});});
 await page.clock.install();await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
 await expect(page.locator('.quote-row .price')).toHaveText('$110.00');await expect(page.locator('.quote-type')).toContainText('delayed');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByRole('tab',{name:/IEX latest/}).click();await expect(page.locator('.quote-row .price')).toHaveText('$111.11');await expect(page.locator('.quote-type')).toContainText('limited venue');await expect(page.locator('.chart-readout')).toContainText('Daily OHLCV');
 await page.clock.runFor(500);const before=requests;status='closed';await page.clock.fastForward(30001);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.clock.fastForward(60001);expect(requests).toBe(before);
 status='open';paused=true;await page.clock.fastForward(30001);await expect(page.locator('.intraday-prices')).toContainText('Price updates paused until');expect(requests).toBe(before);expect(errors).toEqual([]);
});
