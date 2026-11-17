"""Stage one immutable local standalone build; never overwrite the running preview."""
from pathlib import Path
import re,shutil,uuid
root=Path(__file__).resolve().parents[1]
output=root/'frontend/.next-build'
identifier=(output/'BUILD_ID').read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9_-]{5,128}',identifier):raise SystemExit('Invalid build identifier')
parent=root/'runtime/preview';parent.mkdir(parents=True,exist_ok=True)
target=parent/identifier
if not target.exists():
    staging=parent/('.building-'+uuid.uuid4().hex)
    shutil.copytree(output/'standalone',staging)
    shutil.copytree(root/'frontend/public',staging/'public',dirs_exist_ok=True)
    shutil.copytree(output/'static',staging/'.next-build/static',dirs_exist_ok=True)
    if not (staging/'server.js').is_file():raise SystemExit('Standalone server missing')
    staging.rename(target)
print(target/'server.js')
