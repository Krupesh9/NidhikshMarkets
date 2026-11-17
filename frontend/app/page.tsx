import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import Workspace from '@/components/Workspace';
export const dynamic='force-dynamic';
export default async function Page(){
 const cookie=(await cookies()).get('nm_session');
 if(!cookie)redirect('/login');
 try{
  const response=await fetch(`${process.env.BACKEND_URL||'http://127.0.0.1:8000'}/auth/session`,{headers:{cookie:`nm_session=${cookie.value}`},cache:'no-store'});
  if(response.status===401)redirect('/login');
 }catch(error){if(error instanceof Error && error.message==='NEXT_REDIRECT')throw error;}
 return <Workspace/>;
}
