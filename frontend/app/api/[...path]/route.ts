import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
async function proxy(request: NextRequest, context: { params: Promise<{path:string[]}> }) {
 const {path}=await context.params;
 if(path.some(p=>p==='..'||p==='.'||p.includes('/')||p.includes('\\'))) return NextResponse.json({detail:'Invalid API path'},{status:400});
 const url = `${backend}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
 const headers=new Headers();
 for(const name of ['cookie','content-type','origin','x-csrf-token']) {const value=request.headers.get(name);if(value)headers.set(name,value);}
 // Loopback binding in development, internal Compose network in deployment.
 // Never trust arbitrary client-supplied forwarding headers for auth decisions.
 headers.set('x-nm-client-ip','same-origin-proxy');
 try {
  const res=await fetch(url,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.text(),cache:'no-store',signal:AbortSignal.timeout(45000),redirect:'manual'});
  const output=new NextResponse(res.body,{status:res.status,headers:{'Content-Type':res.headers.get('content-type')||'application/json','Cache-Control':'no-store'}});
  for(const cookie of res.headers.getSetCookie())output.headers.append('set-cookie',cookie);
  return output;
 }catch{return NextResponse.json({detail:'Backend unavailable. Start the local API and retry.'},{status:503});}
}
export {proxy as GET,proxy as POST,proxy as PUT,proxy as DELETE};
