"""Cache a broad IPO schedule without requiring listed instrument records."""
from alembic import op
import sqlalchemy as sa
revision='a60d1c83e742'
down_revision='876230bd746d'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('ipo_calendar_cache',sa.Column('provider',sa.String(),primary_key=True),sa.Column('fetched_at',sa.String(),nullable=False),sa.Column('source_url',sa.String(),nullable=False),sa.Column('items',sa.JSON(),nullable=False))

def downgrade():
    op.drop_table('ipo_calendar_cache')
