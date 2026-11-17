"""Read-only validation only. Does not SSH, create directories, or deploy."""
import ipaddress
import os
import shutil
import subprocess
from pathlib import Path
from dotenv import dotenv_values

config={**dotenv_values('.env'),**os.environ}
errors=[]
for name in ['NAS_DATA_DIR','NAS_BACKUP_DIR']:
    value=config.get(name,'')
    if not value or not Path(value).is_absolute():errors.append(name+' must be an approved absolute path on the NAS local filesystem')
    elif not Path(value).is_dir():errors.append(name+' must already exist on the verified NAS host; this check never creates folders')
if config.get('NAS_DATA_DIR')==config.get('NAS_BACKUP_DIR'):errors.append('Data and backup destinations must differ')
try:
    address=ipaddress.ip_address(config.get('NAS_BIND_IP','127.0.0.1'))
    if not (address.is_loopback or address.is_private) or address.is_unspecified:errors.append('NAS_BIND_IP must be a specific loopback or private address')
except ValueError:errors.append('NAS_BIND_IP must be a literal private IP address')
if not config.get('APP_ORIGIN','').startswith('https://'):errors.append('NAS APP_ORIGIN must use the separately approved private HTTPS gateway')
if not shutil.which('docker'):errors.append('Docker is unavailable. No installation attempted.')
else:
    result=subprocess.run(['docker','compose','version'],capture_output=True,text=True)
    if result.returncode:errors.append('Docker Compose unavailable')
if errors:
    print('Not ready for NAS deployment:')
    for error in errors:print('- '+error)
    raise SystemExit(1)
print('Local configuration checks passed. Confirm UGOS, CPU, ownership UID 10001, local filesystem, free space, TLS gateway and owner approval separately before deploy-nas.')
