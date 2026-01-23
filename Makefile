ARGS ?=

.PHONY: all
all:
	@echo "imaged"
	@echo "make <cmd>"
	@echo ""
	@echo "commands:"
	@echo "  build       - build the imaged docker container"
	@echo "  run         - start the imaged service in a docker container"
	@echo ""
	@echo "options:"
	@echo "  ARGS=...    - pass arguments to the container (e.g. make run ARGS='--port 3000')"

.PHONY: build
build:
	@docker build -t imaged .

.PHONY: run
run: build
	@docker run -it --rm --init --network host --name imaged imaged $(ARGS)
