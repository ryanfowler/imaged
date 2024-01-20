PORT ?= 8000

.PHONY: all
all:
	@echo "imaged"
	@echo "make <cmd>"
	@echo ""
	@echo "commands:"
	@echo "  build       - build the imaged docker container"
	@echo "  start       - start the imaged service in a docker container"
	@echo "  stop        - stop the running imaged docker container"

.PHONY: build
build:
	@docker build -t imaged .

.PHONY: start
start: build
	@docker run -itd --rm --network host --env PORT=$(PORT) --name imaged imaged

.PHONY: stop
stop:
	@docker stop imaged
