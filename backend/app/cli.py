"""Local-only operations; no anonymous HTTP setup or public signup."""
import argparse
import asyncio
import getpass
import json
import os
import secrets
import shutil
import sqlite3
import sys
from pathlib import Path
from sqlalchemy import select,delete,func
from alembic.config import Config
from alembic import command
from .config import ROOT,settings
from .db import transaction,engine
from .models import *
from .auth import passwords
from .universe import UNIVERSE,CORE
from .signals import VERSION
from .schemas import StrategyConfig


def migrate():
    command.upgrade(Config(str(ROOT/'backend/alembic.ini')),'head')

def seed():
    with transaction() as db:
        for code in ['XNYS','XNAS']:
            if not db.get(Exchange,code):
                db.add(Exchange(code=code,timezone='America/New_York',calendar='XNYS'))
        db.flush()
        for symbol,name,asset,cik in UNIVERSE:
            if not db.scalar(select(Instrument).where(Instrument.symbol==symbol)):
                db.add(Instrument(symbol=symbol,name=name,asset_type=asset,cik=cik,exchange='XNAS' if symbol in CORE else 'XNYS',note='Daily-reset 3× leveraged ETF; compounding risk, not a long-term 3× index return.' if symbol=='SOXL' else 'Commodity fund: futures/roll effects; not spot commodity.' if symbol=='USO' else ''))
        for strategy in ['trend','mean_reversion','breakout']:
            if not db.get(StrategyDefinition,strategy):
                db.add(StrategyDefinition(id=strategy,version=VERSION,parameters=StrategyConfig().model_dump()))

def create_user(username,role,password=None):
    password=password or getpass.getpass('New password (minimum 12 characters): ')
    if len(password)<12:
        raise SystemExit('Password must contain at least 12 characters')
    with transaction() as db:
        if db.scalar(select(User).where(User.username==username.lower())):
            raise SystemExit('Username already exists; use reset-password')
        user=User(username=username.lower(),password_hash=passwords.hash(password),role=role)
        db.add(user); db.flush()
        db.add(Watchlist(user_id=user.id,name='Core watchlist',symbols=CORE))
        db.add(AuditEvent(user_id=user.id,action='user_created_locally'))

def bootstrap():
    migrate(); seed()
    with transaction() as db:
        exists=db.scalar(select(User.id).limit(1))
    if not exists:
        password=secrets.token_urlsafe(20)
        create_user('owner','admin',password)
        dest=ROOT/'runtime/first-login.txt'
        dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as file:
            file.write(f'Username: owner\nPassword: {password}\n\nUnique local credential. Change with make reset-password. Do not share this file.\n')
        print('Created unique owner login. Open runtime/first-login.txt locally; no password printed.')
    print('Schema migrated; universe and strategy definitions ready.')

def sqlite_path():
    url=settings().database_url
    if not url.startswith('sqlite:///'):
        raise SystemExit('SQLite operation requires a SQLite database URL')
    return Path(url.removeprefix('sqlite:///')).resolve()

def backup(destination):
    source=sqlite_path(); dest=Path(destination).resolve()
    if dest.exists() or source==dest:
        raise SystemExit('Backup destination must be a new file')
    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); os.close(fd)
    with sqlite3.connect(source) as src,sqlite3.connect(dest) as out:
        src.backup(out)
        if out.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise SystemExit('Backup failed integrity check')
    print('Online SQLite backup completed and integrity verified.')

def restore_test(source):
    import tempfile
    with tempfile.TemporaryDirectory(prefix='nm-restore-') as tmp:
        dest=Path(tmp)/'restored.sqlite'
        with sqlite3.connect(f'file:{Path(source).resolve()}?mode=ro',uri=True) as src,sqlite3.connect(dest) as out:
            src.backup(out)
            assert out.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert not out.execute('PRAGMA foreign_key_check').fetchall()
            tables=[r[0] for r in out.execute("select name from sqlite_master where type='table'")]
            assert 'users' in tables and 'price_bars' in tables and 'alembic_version' in tables
            print(f'Restored to isolated temporary directory; {len(tables)} tables, integrity and foreign keys verified.')

def import_legacy(source):
    # Read-only legacy schema export, separate modern runtime database, no overwrite.
    # Unknown adjustment/feed is quarantined; never queried as Alpaca history.
    srcpath=Path(source).resolve()
    if srcpath==sqlite_path():
        raise SystemExit('Legacy source must differ from runtime DB. Source is never modified.')
    with sqlite3.connect(f'file:{srcpath}?mode=ro',uri=True) as src:
        src.row_factory=sqlite3.Row
        instruments={r['id']:dict(r) for r in src.execute('select * from instruments')}
        bars=[dict(r) for r in src.execute('select * from price_bars')]
    migrate(); seed(); count=0
    from .ingestion import upsert
    with transaction() as db:
        for b in bars:
            symbol=instruments[b['instrument_id']]['symbol']
            i=db.scalar(select(Instrument).where(Instrument.symbol==symbol))
            if not i:
                continue
            fetched=b['fetched_at_utc']
            upsert(db,PriceBar,dict(instrument_id=i.id,timeframe=b['timeframe'],timestamp=b['timestamp_utc'],open=b['open'],high=b['high'],low=b['low'],close=b['close'],volume=b['volume'] or 0,provider='legacy_unverified',feed='unknown',adjustment='unknown',event_time=b['timestamp_utc'],available_at=fetched,observed_at=fetched,fetched_at=fetched,source_last_updated=None,provenance={'source':b['source'],'quality_flags':['legacy unverified; quarantined; adjustment and availability unknown']}),['instrument_id','timeframe','timestamp','provider','feed','adjustment'],update=False)
            count+=1
    print(f'Legacy inspected read-only: {len(instruments)} instruments, {len(bars)} bars; {count} bars imported to quarantine. Starter source unchanged.')

def main():
    p=argparse.ArgumentParser(description='Nidhiksh Markets private local operations')
    p.add_argument('action',choices=['init','create-user','reset-password','revoke-user','refresh','backup','restore-test','import-legacy','health'])
    p.add_argument('--username',default='owner');p.add_argument('--role',choices=['admin','viewer'],default='viewer')
    p.add_argument('--path');p.add_argument('--providers',default='alpaca,alpaca_news,sec,fred,gdelt')
    args=p.parse_args()
    if args.action=='init': bootstrap()
    elif args.action=='create-user': create_user(args.username,args.role)
    elif args.action in ['reset-password','revoke-user']:
        password=getpass.getpass('New password (minimum 12 characters): ') if args.action=='reset-password' else None
        if password is not None and len(password)<12:
            raise SystemExit('Password must contain at least 12 characters')
        with transaction() as db:
            user=db.scalar(select(User).where(User.username==args.username.lower()))
            if not user: raise SystemExit('User not found')
            if password: user.password_hash=passwords.hash(password); user.active=True
            else: user.active=False
            db.execute(delete(LoginSession).where(LoginSession.user_id==user.id))
            db.add(AuditEvent(user_id=user.id,action=args.action+'_locally'))
        print('Account updated and all sessions revoked.')
    elif args.action=='refresh':
        from .ingestion import refresh
        print(json.dumps(asyncio.run(refresh(args.providers.split(','))),indent=2))
    elif args.action=='backup':
        if not args.path: p.error('--path required')
        backup(args.path)
    elif args.action=='restore-test':
        if not args.path: p.error('--path required')
        restore_test(args.path)
    elif args.action=='import-legacy': import_legacy(args.path or str(ROOT/'starter_database/market_terminal.sqlite'))
    elif args.action=='health':
        with transaction() as db:
            print(json.dumps({'database':'ok','instruments':db.scalar(select(func.count()).select_from(Instrument)),'bars':db.scalar(select(func.count()).select_from(PriceBar))}))

if __name__=='__main__': main()
