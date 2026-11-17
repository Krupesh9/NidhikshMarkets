import {test,expect} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';

test('selected ranges compare their starting close with the latest quote and handle missing data',async({page,context})=>{
 const login=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');
 const auth=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:login.match(/Username: (.+)/)![1],password:login.match(/Password: (.+)/)![1]}});expect(auth.ok()).toBeTruthy();
 const settings=await(await context.request.get('/api/settings')).json();settings.workspace={...settings.workspace,symbol:'NVDA',mode:'market',range:'1y',show_signals:false};
 await page.route('**/api/settings',route=>route.fulfill({json:settings}));await page.route('**/api/settings/workspace',route=>route.fulfill({json:{}}));
 let latest:number|null=120,invalidStart=false,refreshes=0;
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status:'closed'}}));
 await page.route('**/api/quotes/intraday?mode=market',route=>route.fulfill({json:{configured:true,session:{status:'closed'},feeds:{iex:{items:{NVDA:latest==null?null:{price:latest,as_of:'2026-11-17T20:00:00Z',change_percent:9.09}}}},budget:{paused:false}}}));
 await page.route('**/api/admin/quotes/intraday/refresh',route=>{refreshes++;return route.fulfill({json:{}});});
 await page.route('**/api/instruments/NVDA/quote?mode=market',route=>route.fulfill({json:{symbol:'NVDA',name:'NVIDIA',price:latest==null?null:110,change_percent:0,freshness:{as_of:'2026-11-16T21:00:00Z'}}}));
 await page.route('**/api/instruments/NVDA/bars?**',route=>{
  const range=new URL(route.request().url()).searchParams.get('range');const five=range==='5y';const first=five?'2021-11-17':'2025-11-17';const start=invalidStart?0:five?40:100;
  return route.fulfill({json:{symbol:'NVDA',supported_ranges:['1y','5y'],total_bars:2,indicators:{},freshness:{status:'cached'},bars:[{timestamp:first+'T00:00:00Z',event_time:first+'T21:00:00Z',open:start,high:start+1,low:start,close:start,volume:100},{timestamp:'2026-11-16T00:00:00Z',event_time:'2026-11-16T21:00:00Z',open:110,high:111,low:109,close:110,volume:100}]}});
 });
 await page.clock.install({time:new Date('2026-11-17T21:00:00Z')});await page.goto('/');
 const one=page.getByRole('region',{name:'1Y price change',exact:true});await expect(one.locator('strong')).toHaveText('+20.00%');await expect(one).toContainText('+$20.00 per share');await expect(one).toContainText('From $100.00 on Nov 17, 2025');await expect(one).toContainText('Nov 17, 2026');await expect(one).toHaveClass(/up/);await expect(page.locator('.quote-row .price')).toHaveText('$120.00');
 await page.getByRole('button',{name:'5Y',exact:true}).click();const five=page.getByRole('region',{name:'5Y price change',exact:true});await expect(five.locator('strong')).toHaveText('+200.00%');await expect(five).toContainText('+$80.00 per share');await expect(five).toContainText('From $40.00 on Nov 17, 2021');
 latest=80;await page.getByRole('button',{name:'1Y',exact:true}).click();await page.getByRole('button',{name:'Reload view',exact:true}).click();await expect(one.locator('strong')).toHaveText('-20.00%');await expect(one).toHaveClass(/down/);await expect(one).toContainText('−$20.00 per share');
 latest=100;await page.getByRole('button',{name:'Reload view',exact:true}).click();await expect(one.locator('strong')).toHaveText('+0.00%');await expect(one).toHaveClass(/neutral/);
 invalidStart=true;await page.getByRole('button',{name:'Reload view',exact:true}).click();await expect(one).toContainText('Period comparison unavailable');await expect(one.locator('strong')).toHaveCount(0);
 invalidStart=false;latest=null;await page.getByRole('button',{name:'Reload view',exact:true}).click();await expect(one).toContainText('Period comparison unavailable');expect(refreshes).toBe(0);
});
