.PHONY: setup dev preview stop logs health refresh-data backup restore-test reset-password nas-config-check deploy-nas rollback test e2e build
setup dev preview stop logs health refresh-data backup restore-test reset-password nas-config-check deploy-nas rollback:
	@bash scripts/manage.sh $@
test:
	PYTHONPATH=backend .venv/bin/pytest backend/tests -q
e2e:
	npm --prefix frontend run test:e2e
build:
	npm --prefix frontend run typecheck
	NEXT_DIST_DIR=.next-build NEXT_TELEMETRY_DISABLED=1 npm --prefix frontend run build
