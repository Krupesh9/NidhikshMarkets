import {test,expect,type Page,type BrowserContext} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
async function isolatedWorkspace(page:Page,context:BrowserContext){
 const t=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');const response=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:{username:t.match(/Username: (.+)/)![1],password:t.match(/Password: (.+)/)![1]}});expect(response.ok()).toBeTruthy();
 const settings=await (await context.request.get('/api/settings')).json();settings.workspace={...settings.workspace,symbol:'AMD',mode:'market',theme:'dark',range:'5y',show_signals:true,chart_strategy:'mean_reversion'};
 // Keep chart exploration isolated from the owner's saved preferences.
 await page.route('**/api/settings',route=>route.fulfill({json:settings}));await page.route('**/api/settings/workspace',route=>route.fulfill({json:JSON.parse(route.request().postData()||'{}')}));
 await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
}
test('candidate badges do not overlap or clip at one, three and five years',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await isolatedWorkspace(page,context);
 for(const strategy of ['Trend','Mean reversion','Breakout']){
  await page.getByRole('tab',{name:strategy,exact:true}).click();
  for(const range of ['1Y','3Y','5Y']){
   const loaded=page.waitForResponse(response=>response.url().includes(`/bars?mode=market&range=${range.toLowerCase()}`)&&response.ok());await page.getByRole('button',{name:range,exact:true}).click();await (await loaded).finished();await page.locator('.chart-canvas canvas').first().waitFor();await page.locator('.chart-canvas').evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   if(strategy==='Mean reversion'&&range==='5Y')await expect(page.locator('.chart-candidate-badge').first()).toBeVisible();
   await expect.poll(async()=>page.locator('.chart-badges').evaluate((e:Element)=>{const c=e.getBoundingClientRect();const boxes=[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return {overflow:boxes.filter(r=>r.x<c.x||r.right>c.right||r.y<c.y||r.bottom>c.bottom).length,overlap:boxes.reduce((n,r,i)=>n+boxes.slice(i+1).filter(s=>r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top).length,0)};})).toEqual({overflow:0,overlap:0});
  }
 }
 expect(errors).toEqual([]);
});
test('expanded heatmap details remain pinned and financial revenue cards use the latest concept',async({page,context})=>{
 await isolatedWorkspace(page,context);
 const revenues=page.locator('.company-financials>.reported-facts>article').filter({hasText:'Revenue · reported period'});await expect(revenues).toHaveCount(1);const facts=(await (await context.request.get('/api/instruments/AMD/fundamentals')).json()).data.facts;const latest=[facts.Revenues?.end,facts.RevenueFromContractWithCustomerExcludingAssessedTax?.end].filter(Boolean).sort().at(-1);await expect(revenues).toContainText(latest);await expect(page.getByText('Older revenue reporting concepts (1)',{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();const cells=page.locator('.heatmap-cell');await cells.first().hover();const tip=page.getByRole('dialog',{name:/market details/});const selected=await tip.getAttribute('aria-label');
 await tip.getByRole('button',{name:'Expand company details'}).click();await cells.last().hover({force:true});await expect(tip).toHaveAttribute('aria-label',selected!);await expect(tip.getByRole('button',{name:'Open research'})).toBeVisible();
 await page.setViewportSize({width:390,height:900});const bounds=(await tip.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);await page.keyboard.press('Escape');await expect(tip).toHaveCount(0);
});
