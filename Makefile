PORT ?= 9000

.PHONY: all
all:
	@echo "imaged"
	@echo "make <cmd>"
	@echo ""
	@echo "commands:"
	@echo "  build       - build the imaged docker container"
	@echo "  lint        - run eslint in a docker container"
	@echo "  start       - start the imaged service in a docker container"
	@echo "  stop        - stop the running imaged docker container"
	@echo "  test        - run integration tests in a docker container"

.PHONY: build
build:
	@docker build -t imagedbuilder --target builder .
	@docker build -t imaged .

.PHONY: lint
lint: build
	@docker run -i --rm --name imagedlint imagedbuilder npm run lint

.PHONY: start
start: build
	@docker run -itd --rm --env PORT=$(PORT) --env TLS_MODE=off --name imaged -p $(PORT):$(PORT) imaged

.PHONY: stop
stop:
	@docker stop imaged

.PHONY: test
test: build
	@docker run -i --rm --name imagedtest --network host imagedbuilder npm run test
