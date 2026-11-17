import {test,expect} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
function auth(){const t=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');return {username:t.match(/Username: (.+)/)![1],password:t.match(/Password: (.+)/)![1]};}
test('Bollinger settings save directly, persist after reload and retain a named preset',async({page,context})=>{
 const login=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:auth()});expect(login.ok()).toBeTruthy();
 const headers={Origin:'http://localhost:3000','X-CSRF-Token':(await login.json()).csrf};const original=await (await context.request.get('/api/settings')).json();
 const presetName=`UI regression ${Date.now()}`;
 try{
  await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
  await page.getByRole('button',{name:'Indicators',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Indicator Studio'});const bb=dialog.locator('.studio-section').filter({has:page.getByText('Bollinger Bands',{exact:true})});
  await bb.getByRole('checkbox').check();await bb.getByLabel('Period',{exact:true}).fill('25');await bb.getByLabel('Standard deviations',{exact:true}).fill('2.5');
  await dialog.getByLabel('Save as a named preset (optional)').fill(presetName);
  await expect(dialog.getByRole('button',{name:'Save & apply'})).toBeEnabled();await dialog.getByRole('button',{name:'Save & apply'}).click();await expect(dialog).toHaveCount(0);
  await expect.poll(async()=>{const s=await (await context.request.get('/api/settings')).json();return [s.indicators.bb,s.indicators.bb_period,s.indicators.bb_std];}).toEqual([true,25,2.5]);
  await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await page.getByRole('button',{name:'Indicators',exact:true}).click();
  const saved=page.getByRole('dialog',{name:'Indicator Studio'}).locator('.studio-section').filter({has:page.getByText('Bollinger Bands',{exact:true})});await expect(saved.getByRole('checkbox')).toBeChecked();await expect(saved.getByLabel('Period',{exact:true})).toHaveValue('25');await expect(saved.getByLabel('Standard deviations',{exact:true})).toHaveValue('2.5');
  expect((await (await context.request.get('/api/presets')).json()).some((p:any)=>p.name===presetName&&p.config.bb_period===25)).toBeTruthy();
 }finally{
  for(const key of ['workspace','indicators'])await context.request.put(`/api/settings/${key}`,{headers,data:original[key]});
  for(const p of await (await context.request.get('/api/presets')).json())if(p.name===presetName)await context.request.delete(`/api/presets/${p.id}`,{headers});
 }
});

test('theme follows market hours and news stays dismissed until a new update arrives',async({page,context})=>{
 const login=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:auth()});expect(login.ok()).toBeTruthy();
 const headers={Origin:'http://localhost:3000','X-CSRF-Token':(await login.json()).csrf};const original=await (await context.request.get('/api/settings')).json();
 let status='open',latest=false;
 await page.route('**/api/markets/session',route=>route.fulfill({json:{status,timezone:'America/New_York',calendar:'Test fixture'}}));
 await page.route('**/api/instruments/NVDA/news?mode=market',route=>route.fulfill({json:{items:[{id:latest?'regression-new':'regression-original',title:latest?'New company update fixture':'Company update fixture',url:'https://example.org/company-news',publisher:'Regression fixture',published_at:'2026-11-16T21:00:00Z'}]}}));
 try{
  await context.request.put('/api/settings/workspace',{headers,data:{...original.workspace,symbol:'NVDA',mode:'market',theme:'auto',dismissed_news:[]}});
  await page.clock.install();await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');status='closed';await page.clock.fastForward(30001);await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const banner=page.getByRole('complementary',{name:'NVDA company news'});await expect(banner).toContainText('Company update fixture');await banner.getByRole('button',{name:'Dismiss current company updates'}).click();await expect(banner).toHaveCount(0);await page.clock.fastForward(400);
  await expect.poll(async()=>{const s=await (await context.request.get('/api/settings')).json();return s.workspace.dismissed_news;}).toContain('NVDA:regression-original');
  await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await expect(banner).toHaveCount(0);
  latest=true;await page.reload();await expect(banner).toContainText('New company update fixture');
  const analyst=page.locator('.analyst-panel');await expect(analyst).toContainText('premium data access');await expect(analyst.getByRole('button',{name:'Analyst data access required'})).toBeDisabled();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();
  const ipos=page.getByRole('region',{name:'Upcoming IPOs'});await expect(ipos).toContainText('Anthropic, PBC');await expect(ipos).toContainText('Nov 19, 2026');await expect(ipos.getByRole('link',{name:'Filed announcement'})).toHaveAttribute('href',/sec.gov/);
 }finally{await context.request.put('/api/settings/workspace',{headers,data:original.workspace});}
});
