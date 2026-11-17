import os
import tempfile
from pathlib import Path
import pytest

TEST_DIR=tempfile.TemporaryDirectory(prefix='nidhiksh-test-')
os.environ['DATABASE_URL']='sqlite:///'+str(Path(TEST_DIR.name)/'test.sqlite')
os.environ['APP_ORIGIN']='http://localhost:3000'
os.environ['COOKIE_SECURE']='false'
os.environ['ALPACA_API_KEY']='test-only-key'
os.environ['ALPACA_SECRET_KEY']='test-only-secret'
os.environ['FRED_API_KEY']='test-only-fred'
os.environ['SEC_USER_AGENT']='NidhikshTest tests@example.org'
os.environ['COLLECTORS_ENABLED']='false'
os.environ['INTRADAY_ENABLED']='false'
os.environ['ALPHA_VANTAGE_API_KEY']='test-only-alpha'
os.environ['ALPHA_VANTAGE_OVERVIEW_ENABLED']='false'
os.environ['FRED_STORAGE_PERMISSION_CONFIRMED']='false'
os.environ['PARTNER_DATA_DISPLAY_APPROVED']='false'
from fastapi.testclient import TestClient
from app.db import Base,engine,transaction
from app.models import User,Watchlist
from app.auth import passwords
from app.cli import seed
from app.main import app

@pytest.fixture(autouse=True)
def database():
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:conn.exec_driver_sql('DROP TABLE IF EXISTS alembic_version')
    from app.cli import migrate
    migrate()
    seed()
    yield

@pytest.fixture
def client():
    with transaction() as db:
        db.add_all([User(username='admin',role='admin',password_hash=passwords.hash('test-admin-password')),User(username='viewer',role='viewer',password_hash=passwords.hash('test-viewer-password'))])
    with TestClient(app) as client:
        yield client

@pytest.fixture
def admin_client(client):
    response=client.post('/auth/login',json={'username':'admin','password':'test-admin-password'},headers={'Origin':'http://localhost:3000'})
    assert response.status_code==200
    client.headers.update({'Origin':'http://localhost:3000','X-CSRF-Token':response.json()['csrf']})
    return client
