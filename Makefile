RELEASE ?= $(shell git rev-parse main)
PROD := docker compose -f compose.prod.yml
DEV := docker compose -f compose.dev.yml

.PHONY: changes release-notes image deploy rollback dev dev-down

# Versionen und Release Notes: docs/release-notes.md
changes:
	@python3 scripts/release_notes.py changes

release-notes:
	@python3 scripts/release_notes.py draft

image:
	@git merge-base --is-ancestor $(RELEASE) main
	@python3 scripts/release_notes.py check $(RELEASE)
	@python3 scripts/release_notes.py check-release $(RELEASE)
	@git archive $(RELEASE) | docker build --build-arg RELEASE_SHA=$(RELEASE) -t sofa:$(RELEASE) -

deploy:
	@test "$(RELEASE)" = "$$(git rev-parse main)" || { echo 'Deploy erlaubt nur den aktuellen main-Commit'; exit 1; }
	@python3 scripts/release_notes.py check-release $(RELEASE)
	@docker image inspect sofa:$(RELEASE) >/dev/null || { echo 'Image fehlt: make image'; exit 1; }
	@RELEASE=$(RELEASE) $(PROD) up -d --no-build --wait --wait-timeout 60
	@python3 scripts/release_notes.py tag $(RELEASE)

rollback:
	@git merge-base --is-ancestor $(RELEASE) main || { echo 'Rollback-Ziel muss auf main liegen'; exit 1; }
	@docker image inspect sofa:$(RELEASE) >/dev/null || { echo 'Image fehlt'; exit 1; }
	@RELEASE=$(RELEASE) $(PROD) up -d --no-build --wait --wait-timeout 60

dev:
	@$(DEV) up -d --build --wait --wait-timeout 60

dev-down:
	@$(DEV) down
