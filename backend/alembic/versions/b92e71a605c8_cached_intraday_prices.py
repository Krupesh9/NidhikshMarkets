"""Persist separate delayed-consolidated and IEX price caches."""
from alembic import op
import sqlalchemy as sa
revision='b92e71a605c8'
down_revision='a60d1c83e742'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('intraday_cache',sa.Column('feed',sa.String(),primary_key=True),sa.Column('last_attempt',sa.String(),nullable=True),sa.Column('fetched_at',sa.String(),nullable=True),sa.Column('status',sa.String(),nullable=False),sa.Column('message',sa.String(),nullable=False),sa.Column('items',sa.JSON(),nullable=False))

def downgrade():
    op.drop_table('intraday_cache')
