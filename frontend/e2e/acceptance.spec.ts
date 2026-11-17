import {test,expect,type APIRequestContext,type BrowserContext} from './fixtures';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.cwd(),'..');
const suffix=crypto.randomBytes(5).toString('hex');
const accounts={admin:{username:`acceptance_admin_${suffix}`,password:crypto.randomBytes(24).toString('base64url')},viewer:{username:`acceptance_viewer_${suffix}`,password:crypto.randomBytes(24).toString('base64url')},expiring:{username:`acceptance_expiry_${suffix}`,password:crypto.randomBytes(24).toString('base64url')}};
function python(script:string,input:unknown){const result=spawnSync(path.join(root,'.venv/bin/python'),['-c',script],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'backend')},input:JSON.stringify(input),encoding:'utf8'});if(result.status!==0)throw new Error('Isolated acceptance account maintenance failed; credentials were not logged.');}
async function login(request:APIRequestContext,account=accounts.admin){const r=await request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:account});expect(r.status()).toBe(200);return {Origin:'http://localhost:3000','X-CSRF-Token':(await r.json()).csrf};}
function freshWorkspace(){return {theme:'auto',mode:'demo',symbol:'NVDA',range:'1y',chart:'candlestick',preset:'Technical',show_signals:false,chart_strategy:'trend',layout:'comfortable',dismissed_news:[]};}
test.beforeAll(()=>python("import sys,json\nfrom app.cli import create_user\np=json.load(sys.stdin)\nfor role,a in p.items():create_user(a['username'],'admin' if role=='admin' else 'viewer',a['password'])",accounts));
test.afterAll(()=>python("import sys,json\nfrom sqlalchemy import select,delete\nfrom app.db import transaction\nfrom app.models import User,AuditEvent,LoginSession,AppSetting,Watchlist,IndicatorPreset\nnames=json.load(sys.stdin)\nwith transaction() as db:\n ids=list(db.scalars(select(User.id).where(User.username.in_(names))))\n for model in [AuditEvent,LoginSession,AppSetting,Watchlist,IndicatorPreset]:db.execute(delete(model).where(model.user_id.in_(ids)))\n db.execute(delete(User).where(User.id.in_(ids)))",Object.values(accounts).map(a=>a.username)));

test('Viewer restrictions, CSRF/origin enforcement and per-user isolation',async({browser})=>{
 const admin=await browser.newContext(),viewer=await browser.newContext();
 try{
  const ah=await login(admin.request),vh=await login(viewer.request,accounts.viewer);
  expect((await viewer.request.get('/api/admin/users')).status()).toBe(403);
  expect((await viewer.request.post('/api/admin/refresh',{headers:vh,data:{providers:['alpaca']}})).status()).toBe(403);
  expect((await viewer.request.get('/api/instruments/NVDA/bars?mode=market')).status()).toBe(403);
  expect((await viewer.request.get('/api/instruments/NVDA/bars?mode=demo')).ok()).toBeTruthy();
  expect((await admin.request.put('/api/settings/workspace',{headers:{Origin:'http://localhost:3000'},data:freshWorkspace()})).status()).toBe(403);
  expect((await admin.request.put('/api/settings/workspace',{headers:{...ah,Origin:'https://untrusted.example'},data:freshWorkspace()})).status()).toBe(403);
  expect((await admin.request.put('/api/settings/workspace',{headers:ah,data:{...freshWorkspace(),theme:'dark'}})).ok()).toBeTruthy();
  expect((await viewer.request.put('/api/settings/workspace',{headers:vh,data:{...freshWorkspace(),theme:'light'}})).ok()).toBeTruthy();
  expect((await admin.request.post('/api/watchlists',{headers:ah,data:{name:'Acceptance private list',symbols:['NVDA','AAPL']}})).ok()).toBeTruthy();
  expect((await admin.request.post('/api/presets',{headers:ah,data:{name:'Acceptance private preset',config:{bb:true,bb_period:25,bb_std:2.5}}})).ok()).toBeTruthy();
  expect((await (await viewer.request.get('/api/watchlists')).json()).some((w:any)=>w.name==='Acceptance private list')).toBeFalsy();
  expect(await (await viewer.request.get('/api/presets')).json()).toEqual([]);
  expect((await (await viewer.request.get('/api/settings')).json()).workspace.theme).toBe('light');
  const owned=(await (await admin.request.get('/api/watchlists')).json()).find((w:any)=>w.name==='Acceptance private list');
  expect((await viewer.request.delete(`/api/watchlists/${owned.id}`,{headers:vh})).status()).toBe(404);
 }finally{await admin.close();await viewer.close();}
});

test('authenticated navigation, chart preferences, scanner and logout',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1600,height:1000}});const errors:string[]=[];
 try{
  const h=await login(context.request);await context.request.put('/api/settings/workspace',{headers:h,data:freshWorkspace()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await expect(page.getByText('SYNTHETIC DEMO',{exact:true})).toBeVisible();await page.locator('.chart-canvas canvas').first().waitFor();
  await page.getByRole('button',{name:'Area chart',exact:true}).click();await page.getByRole('button',{name:'3M',exact:true}).click();
  await expect.poll(async()=>{const s=await (await context.request.get('/api/settings')).json();return [s.workspace.chart,s.workspace.range];}).toEqual(['area','3m']);
  await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await expect(page.getByRole('button',{name:'Area chart',exact:true})).toHaveAttribute('aria-pressed','true');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('button',{name:'Watchlists',exact:true}).click();await expect(page.locator('.watchlists-page')).toBeVisible();
  await nav.getByRole('button',{name:'Research',exact:true}).click();await page.locator('.chart-canvas canvas').first().waitFor();
  await nav.getByRole('button',{name:'Signals',exact:true}).click();await expect(page.getByRole('heading',{name:'NVDA · Candidate history'})).toBeVisible();
  await nav.getByRole('button',{name:'News & Filings',exact:true}).click();await expect(page.locator('.news-page')).toBeVisible();
  await nav.getByRole('button',{name:'Markets',exact:true}).click();await expect(page.getByRole('heading',{name:'Local research scanner'})).toBeVisible();await page.getByLabel('Scanner filter').selectOption('above_sma200');await expect(page.locator('.local-scanner tbody tr').first()).toBeVisible();
  await nav.getByRole('button',{name:'Earnings Calendar',exact:true}).click();await expect(page.locator('.calendar-grid')).toHaveCSS('display','grid');
  await nav.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByLabel('Appearance')).toHaveValue('auto');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login/);expect((await context.request.get('/api/settings')).status()).toBe(401);
  expect(errors).toEqual([]);
 }finally{await context.close();}
});

test('unavailable bars show an explicit error without manufacturing a chart',async({browser})=>{
 const context=await browser.newContext();
 try{
  const h=await login(context.request);await context.request.put('/api/settings/workspace',{headers:h,data:freshWorkspace()});
  const page=await context.newPage();await page.route('**/api/instruments/NVDA/bars?**',route=>route.fulfill({status:503,json:{detail:'Simulated backend outage; cached source data remains unchanged.'}}));
  await page.goto('/');await expect(page.locator('.error[role="alert"]')).toContainText('Simulated backend outage');await expect(page.locator('.chart-canvas canvas')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await page.unroute('**/api/instruments/NVDA/bars?**');await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.chart-canvas canvas').first().waitFor();
 }finally{await context.close();}
});

test('expired and revoked sessions cannot access the workspace',async({browser})=>{
 const admin=await browser.newContext(),expiring=await browser.newContext(),viewer=await browser.newContext();
 try{
  const ah=await login(admin.request);await login(expiring.request,accounts.expiring);await login(viewer.request,accounts.viewer);
  const page=await expiring.newPage();await page.goto('/');await page.getByRole('heading',{name:'The broader view.'}).waitFor();await page.locator('.chart-canvas canvas').first().waitFor();await page.locator('.market-tile').first().waitFor();
  python("import sys,json\nfrom sqlalchemy import select,update\nfrom app.db import transaction\nfrom app.models import User,LoginSession\nname=json.load(sys.stdin)\nwith transaction() as db:\n uid=db.scalar(select(User.id).where(User.username==name))\n db.execute(update(LoginSession).where(LoginSession.user_id==uid).values(expires_at='2000-01-01T00:00:00Z'))",accounts.expiring.username);
  expect((await expiring.request.get('/api/settings')).status()).toBe(401);
  // The running workspace polls session-protected provider status every five seconds.
  // Its 401 handling must redirect automatically; do not reload during that navigation.
  await expect(page).toHaveURL(/\/login/,{timeout:15000});
  const user=(await (await admin.request.get('/api/admin/users')).json()).find((u:any)=>u.username===accounts.viewer.username);
  expect((await admin.request.delete(`/api/admin/users/${user.id}/sessions`,{headers:ah})).ok()).toBeTruthy();expect((await viewer.request.get('/api/settings')).status()).toBe(401);
 }finally{await admin.close();await expiring.close();await viewer.close();}
});
