RELEASE ?= $(shell git rev-parse main)
PROD := docker compose -f compose.prod.yml
DEV := docker compose -f compose.dev.yml

.PHONY: image deploy rollback dev dev-down

image:
	@git merge-base --is-ancestor $(RELEASE) main
	@git archive $(RELEASE) | docker build --build-arg RELEASE_SHA=$(RELEASE) -t sofa:$(RELEASE) -

deploy:
	@test "$(RELEASE)" = "$$(git rev-parse main)" || { echo 'Deploy erlaubt nur den aktuellen main-Commit'; exit 1; }
	@docker image inspect sofa:$(RELEASE) >/dev/null || { echo 'Image fehlt: make image'; exit 1; }
	@RELEASE=$(RELEASE) $(PROD) up -d --no-build --wait --wait-timeout 60

rollback:
	@git merge-base --is-ancestor $(RELEASE) main || { echo 'Rollback-Ziel muss auf main liegen'; exit 1; }
	@docker image inspect sofa:$(RELEASE) >/dev/null || { echo 'Image fehlt'; exit 1; }
	@RELEASE=$(RELEASE) $(PROD) up -d --no-build --wait --wait-timeout 60

dev:
	@$(DEV) up -d --build --wait --wait-timeout 60

dev-down:
	@$(DEV) down
