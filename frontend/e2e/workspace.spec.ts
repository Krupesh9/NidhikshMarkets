// Focused local UI regression coverage; full acceptance and video remain separate.
import {test,expect} from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
function credentials(){
 if(process.env.NM_E2E_USERNAME&&process.env.NM_E2E_PASSWORD)return {username:process.env.NM_E2E_USERNAME,password:process.env.NM_E2E_PASSWORD};
 const file=fs.readFileSync(path.resolve(process.cwd(),'../runtime/first-login.txt'),'utf8');
 return {username:file.match(/Username: (.+)/)![1],password:file.match(/Password: (.+)/)![1]};
}
test('anonymous API and workspace are protected',async({page,request})=>{
 expect((await request.get('/api/settings')).status()).toBe(401);
 await page.goto('/');await expect(page).toHaveURL(/\/login/);
});
test('cached research, chart controls, markers, search, heatmaps and calendar',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/login');const auth=credentials();await page.getByLabel('Username',{exact:true}).fill(auth.username);await page.getByLabel('Password',{exact:true}).fill(auth.password);await page.getByRole('button',{name:'Open workspace',exact:true}).click();
 await expect(page.getByRole('heading',{name:'The broader view.'})).toBeVisible();
 await page.getByLabel('Data mode',{exact:true}).selectOption('market');
 await page.locator('.chart-canvas canvas').first().waitFor({state:'visible',timeout:15000});
 await page.getByRole('button',{name:'Line chart',exact:true}).click();await expect(page.getByRole('button',{name:'Line chart',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Candlestick chart',exact:true}).click();
 await page.getByRole('tab',{name:'Technical',exact:true}).click();
 const markers=page.getByRole('switch',{name:'Show buy and sell candidate markers'});
 if(await markers.getAttribute('aria-checked')==='false')await markers.click();
 await page.getByRole('tab',{name:'Trend',exact:true}).click();
 await expect(markers).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'Search symbols & actions'}).click();await page.getByLabel('Command search',{exact:true}).fill('Space X');await expect(page.locator('.command-results').getByText('SPCX',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();
 await expect(page.getByRole('tablist',{name:'Heatmap universe'})).toBeVisible();
 await page.getByRole('tab',{name:'S&P 500',exact:true}).click();
 await expect(page.locator('.heatmap-cell').first()).toBeVisible();
 await page.locator('.heatmap-cell').first().hover();await expect(page.getByRole('dialog',{name:/market details/})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Earnings Calendar',exact:true}).click();
 await page.getByRole('tab',{name:'Week',exact:true}).click();await expect(page.getByRole('tab',{name:'Week',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Month',exact:true}).click();await expect(page.getByLabel('Earnings company scope')).toHaveValue('sp500');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Data connections',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});


test('calendar, financial cards and hover strips keep their layout after reload',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.request().resourceType()==='stylesheet'&&response.status()>=400)errors.push(`Stylesheet HTTP ${response.status()}`);});
 const auth=credentials();expect((await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:auth})).ok()).toBeTruthy();
 const nav=page.getByRole('navigation',{name:'Main navigation'});
 await page.goto('/');await page.locator('.fundamentals-strip').waitFor();
 for(const width of [1600,900]){
  await page.setViewportSize({width,height:1000});
  await expect(page.locator('.fundamentals-strip')).toHaveCSS('display','grid');
  await expect(page.locator('.company-financials>.reported-facts')).toHaveCSS('display','grid');
 }
 await page.setViewportSize({width:1600,height:1000});
 await page.locator('.company-financials').screenshot({path:path.resolve(process.cwd(),'../artifacts/ui-financials-fixed.png')});
 await nav.getByRole('button',{name:'Earnings Calendar',exact:true}).click();
 await expect(page.locator('.earnings-event').first()).toBeVisible();
 await expect(page.locator('.calendar-grid')).toHaveCSS('display','grid');
 expect(await page.locator('.calendar-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(7);
 const event=page.locator('.earnings-event').first();await event.hover();
 const tooltip=page.getByRole('dialog',{name:/earnings expectations/});await expect(tooltip).toBeVisible();
 const before=(await tooltip.boundingBox())!;expect(before.height).toBeLessThan(115);
 const target=(await event.boundingBox())!;await page.mouse.move(target.x+10,target.y+10);const after=(await tooltip.boundingBox())!;
 expect(Math.abs(before.y-after.y)+Math.abs(before.x-after.x)).toBeGreaterThan(1);
 await tooltip.getByRole('button',{name:'Expand company details'}).click();await expect(tooltip.getByText('Expected reporting date',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(tooltip).toHaveCount(0);
 await page.screenshot({path:path.resolve(process.cwd(),'../artifacts/ui-calendar-fixed.png'),fullPage:true});
 await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await expect(page.locator('.fundamentals-strip')).toHaveCSS('display','grid');
 await nav.getByRole('button',{name:'Markets',exact:true}).click();await page.locator('.heatmap-cell').first().hover();
 const marketTip=page.getByRole('dialog',{name:/market details/});await expect(marketTip).toBeVisible();expect((await marketTip.boundingBox())!.height).toBeLessThan(115);await expect(marketTip.locator('svg[role="img"]')).toBeVisible();
 await expect(page.locator('.market-tile').first()).toBeVisible();await page.screenshot({path:path.resolve(process.cwd(),'../artifacts/ui-heatmap-strip-fixed.png')});await page.keyboard.press('Escape');
 for(const width of [900,390]){
  await page.setViewportSize({width,height:1000});await nav.getByRole('button',{name:'Earnings Calendar',exact:true}).click();await page.locator('.earnings-event').first().hover();
  const bounds=(await page.getByRole('dialog',{name:/earnings expectations/}).boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);await page.keyboard.press('Escape');
 }
 expect(errors).toEqual([]);
});
