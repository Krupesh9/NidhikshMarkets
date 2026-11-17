import {test,expect,type Page,type BrowserContext} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
async function openWorkspace(page:Page,context:BrowserContext){
 const t=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');const auth=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:t.match(/Username: (.+)/)![1],password:t.match(/Password: (.+)/)![1]}});expect(auth.ok()).toBeTruthy();
 const settings=await (await context.request.get('/api/settings')).json();settings.workspace={...settings.workspace,theme:'dark',mode:'market'};await page.route('**/api/settings',route=>route.fulfill({json:settings}));await page.route('**/api/settings/workspace',route=>route.fulfill({json:JSON.parse(route.request().postData()||'{}')}));await page.clock.install();await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
}
test('calendar refresh failure is shown and its action recovers without an unhandled error',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openWorkspace(page,context);
 await page.route('**/api/earnings?**',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({json:{...data,configured:true,can_refresh:true}});});
 await page.route('**/api/admin/earnings/refresh',route=>route.fulfill({json:{status:'queued'}}));
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Earnings Calendar',exact:true}).click();const refresh=page.getByRole('button',{name:'Refresh calendar',exact:true});await expect(refresh).toBeEnabled();
 await page.route('**/api/providers/status',route=>route.fulfill({status:503,json:{detail:'Calendar status unavailable (regression fixture)'}}));
 const queued=page.waitForResponse(response=>response.url().endsWith('/api/admin/earnings/refresh'));await refresh.click();await (await queued).finished();await page.clock.runFor(25);await page.clock.fastForward(2501);await expect(page.locator('.earnings-panel').getByRole('alert')).toContainText('Calendar status unavailable');await expect(refresh).toBeEnabled();expect(errors).toEqual([]);
});
test('heatmap refresh timeout releases its busy action and keeps the cached tiles',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openWorkspace(page,context);
 await page.route('**/api/admin/heatmap/refresh',route=>route.fulfill({json:{status:'queued'}}));await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();await expect(page.locator('.heatmap-cell').first()).toBeVisible();
 await page.route('**/api/providers/status',route=>route.fulfill({json:{providers:[],refresh_running:true}}));
 const queued=page.waitForResponse(response=>response.url().endsWith('/api/admin/heatmap/refresh'));await page.getByRole('button',{name:'Refresh prices',exact:true}).click();await (await queued).finished();await page.clock.runFor(25);await expect(page.getByRole('button',{name:'Working…',exact:true})).toBeDisabled();await page.clock.fastForward(60001);
 await expect(page.locator('.heatmap-panel').getByRole('alert')).toContainText('taking longer than expected');await expect(page.getByRole('button',{name:'Refresh prices',exact:true})).toBeEnabled();await expect(page.locator('.heatmap-cell').first()).toBeVisible();expect(errors).toEqual([]);
});
