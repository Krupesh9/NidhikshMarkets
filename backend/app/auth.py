import hashlib
import secrets
from datetime import datetime,timedelta,timezone
from fastapi import Request,HTTPException,Depends
from pwdlib import PasswordHash
from sqlalchemy import select,delete
from .db import transaction
from .models import User,LoginSession,LoginAttempt,AuditEvent,now
from .config import settings

passwords=PasswordHash.recommended()
DUMMY_HASH=passwords.hash(secrets.token_urlsafe(24))
COOKIE='nm_session'

def digest(token:str):
    return hashlib.sha256(token.encode()).hexdigest()

def check_origin(request:Request):
    if request.headers.get('origin') != settings().app_origin:
        raise HTTPException(403,'Request origin is not allowed')

def current_user(request:Request) -> User:
    token=request.cookies.get(COOKIE,'')
    with transaction() as db:
        session=db.get(LoginSession,digest(token)) if token else None
        if not session or session.expires_at<=now():
            raise HTTPException(401,'Sign in required')
        user=db.get(User,session.user_id)
        if not user or not user.active:
            raise HTTPException(401,'Session revoked')
        if request.method not in ['GET','HEAD','OPTIONS']:
            check_origin(request)
            if not secrets.compare_digest(request.headers.get('x-csrf-token',''),session.csrf):
                raise HTTPException(403,'CSRF token required')
        request.state.csrf=session.csrf
        return user

def admin(user:User=Depends(current_user)):
    if user.role!='admin':
        raise HTTPException(403,'Administrator access required')
    return user

def data_access(user:User,mode:str):
    if mode=='demo' and not settings().demo_enabled:
        raise HTTPException(403,'Demo mode disabled')
    if mode=='market' and user.role!='admin' and not settings().partner_data_display_approved:
        raise HTTPException(403,'Partner market-data display rights are not approved. Use synthetic demo mode.')

def login(request:Request,username:str,password:str):
    check_origin(request)
    # Next proxy overwrites this header with its trusted inbound address; backend has no public port.
    ip=request.headers.get('x-nm-client-ip') or (request.client.host if request.client else 'unknown')
    key=digest(ip)
    with transaction() as db:
        attempt=db.get(LoginAttempt,key)
        if attempt and attempt.reset_at>now() and attempt.attempts>=8:
            raise HTTPException(429,'Too many login attempts; try again in 15 minutes')
        user=db.scalar(select(User).where(User.username==username.lower()))
        verified=passwords.verify(password,user.password_hash if user else DUMMY_HASH)
        if not user or not user.active or not verified:
            if not attempt:
                attempt=LoginAttempt(key=key,attempts=0,reset_at=(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat().replace('+00:00','Z'))
                db.add(attempt)
            if attempt.reset_at<=now():
                attempt.attempts=0
                attempt.reset_at=(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat().replace('+00:00','Z')
            attempt.attempts+=1
            db.add(AuditEvent(action='login_failed'))
            result=None
        else:
            if attempt:
                db.delete(attempt)
            token=secrets.token_urlsafe(48); csrf=secrets.token_urlsafe(32)
            expires=(datetime.now(timezone.utc)+timedelta(hours=settings().session_hours)).isoformat().replace('+00:00','Z')
            db.execute(delete(LoginSession).where(LoginSession.expires_at<now()))
            db.add(LoginSession(token_hash=digest(token),user_id=user.id,csrf=csrf,expires_at=expires))
            db.add(AuditEvent(user_id=user.id,action='login'))
            result=(token,csrf,user)
    if result is None:
        raise HTTPException(401,'Invalid username or password')
    return result
