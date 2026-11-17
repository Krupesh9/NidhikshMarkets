import {test,expect} from './fixtures';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.cwd(),'..');
const account={username:`theme_viewer_${crypto.randomBytes(5).toString('hex')}`,password:crypto.randomBytes(24).toString('base64url')};
function python(script:string,input:unknown){const result=spawnSync(path.join(root,'.venv/bin/python'),['-c',script],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'backend')},input:JSON.stringify(input),encoding:'utf8'});if(result.status!==0)throw new Error('Temporary theme account maintenance failed; no credentials logged.');}
test.beforeAll(()=>python("import sys,json\nfrom app.cli import create_user\na=json.load(sys.stdin)\ncreate_user(a['username'],'viewer',a['password'])",account));
test.afterAll(()=>python("import sys,json\nfrom sqlalchemy import select,delete\nfrom app.db import transaction\nfrom app.models import User,AuditEvent,LoginSession,AppSetting,Watchlist,IndicatorPreset\nname=json.load(sys.stdin)\nwith transaction() as db:\n uid=db.scalar(select(User.id).where(User.username==name))\n if uid:\n  for model in [AuditEvent,LoginSession,AppSetting,Watchlist,IndicatorPreset]:db.execute(delete(model).where(model.user_id==uid))\n  db.execute(delete(User).where(User.id==uid))",account.username));

test('header toggles immediately without navigation, choices persist, and Auto follows market hours',async({page,context})=>{
 const login=await context.request.post('/api/auth/login',{headers:{Origin:'http://localhost:3000'},data:account});expect(login.ok()).toBeTruthy();
 const settings=await(await context.request.get('/api/settings')).json();expect(settings.workspace.theme).toBe('auto');
 let status='open';await page.route('**/api/markets/session',route=>route.fulfill({json:{status}}));
 await page.clock.install();await page.goto('/');await page.locator('.chart-canvas canvas').first().waitFor();
 const toggle=page.getByRole('button',{name:'Toggle dark mode',exact:true});
 const theme=(value:string)=>expect(page.locator('html')).toHaveAttribute('data-theme',value);
 async function persisted(value:string){await page.clock.runFor(450);await expect.poll(async()=>(await(await context.request.get('/api/settings')).json()).workspace.theme).toBe(value);}
 async function preferences(){await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Settings',exact:true}).click();return page.getByLabel('Appearance',{exact:true});}
 await theme('light');await expect(toggle).toHaveAttribute('aria-pressed','false');
 await toggle.click();await theme('dark');await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(page.locator('.breadcrumb strong')).toHaveText('Home');await persisted('dark');
 await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await theme('dark');
 await toggle.click();await theme('light');await expect(page.locator('.breadcrumb strong')).toHaveText('Home');await persisted('light');
 status='closed';await page.clock.fastForward(30001);await theme('light');
 let appearance=await preferences();await expect(appearance).toHaveValue('light');await appearance.selectOption('dark');await theme('dark');await persisted('dark');
 await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();await theme('dark');appearance=await preferences();await expect(appearance).toHaveValue('dark');
 await appearance.selectOption('light');await theme('light');await persisted('light');await appearance.selectOption('auto');await theme('dark');await persisted('auto');
 status='open';await page.clock.fastForward(30001);await theme('light');status='closed';await page.clock.fastForward(30001);await theme('dark');
 await page.reload();await page.locator('.chart-canvas canvas').first().waitFor();appearance=await preferences();await expect(appearance).toHaveValue('auto');await theme('dark');
});
