import {request,type FullConfig} from '@playwright/test';
export default async function ready(config:FullConfig){
 const baseURL=config.projects[0].use.baseURL as string;const client=await request.newContext({baseURL,timeout:2000});const deadline=Date.now()+60000;
 try{
  while(Date.now()<deadline){
   try{
    const login=await client.get('/login'),session=await client.get('/api/auth/session');
    if(login.ok()&&session.status()===401)return;
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Local frontend/API is not ready. Start the workspace services before running E2E tests.');
 }finally{await client.dispose();}
}
