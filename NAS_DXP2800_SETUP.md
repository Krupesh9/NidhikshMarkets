# Nidhiksh Markets — UGREEN NASync DXP2800 deployment checklist

Target: local-only Docker deployment of Next.js, FastAPI, scheduled collectors, and SQLite on persistent NAS storage.

## Before any changes
- Verify authorized NAS access and UGOS Pro/Docker version, hardware architecture, free disk/RAM, actual storage paths, existing Docker projects and port conflicts.
- Inspect only until owner explicitly approves a proposed change plan. Never overwrite existing data.
- Prepare app auth, secrets handling, LAN-only ports, SQLite backup/restore, and rollback.

## After approval
- Build architecture-compatible production images; pin versions.
- Create private persistent data folders with restrictive permissions.
- Run Compose with health checks, restart policies and a single SQLite writer.
- Do not expose FastAPI, SQLite, NAS admin or Docker daemon externally.
- Test from MacBook and after service restart; test backup and restore.
- Remote access with Tailscale is optional, requires separate owner approval and least-privilege ACLs.

## Agent instruction
Read MASTER_PROMPT.md in full. Inspect the NAS only using existing authorized access. Present actual discovered NAS configuration and exact commands/paths for approval before any deployment. If not connected, ask for LAN address and preferred authorized access method. Never ask for passwords to be pasted into chat.

## Current code status

Dockerfiles, compose.dev.yml, compose.nas.yml, the Makefile and confirmation-gated deployment helper now exist. They are **prepared, not deployed or Docker-build verified**. The owner explicitly deferred NAS work until after the demo. No NAS discovery, installation, storage creation, firewall change, port exposure or container deployment occurred.

The NAS Compose defaults to loopback and requires approved existing data/backup directories plus a private HTTPS origin. Backend UID/GID is 10001. Use NAS-local storage, one backend replica and an approved TLS gateway. Never use the Mac's current `.env` NAS fields as discovered paths.
