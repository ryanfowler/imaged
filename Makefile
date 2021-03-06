.PHONY: all
all:
	@echo "imaged"
	@echo "make <cmd>"
	@echo ""
	@echo "commands:"
	@echo "  build       - build the docker container"
	@echo "  lint        - run eslint"
	@echo "  run         - run the service in a docker container"
	@echo "  test        - run tests in a docker container"

.PHONY: build
build:
	@docker build -t imagedbuilder --target builder .
	@docker build -t imaged .

.PHONY: lint
lint: build
	@docker run -i --rm --name imaged imagedbuilder npm run lint

.PHONY: run
run: build
	@docker run -it --rm --env-file .env --name imaged -p 9000:9000 imaged

.PHONY: start
start: build
	@docker run -itd --rm --env PORT=9000 --env TLS_MODE=off --network host --name imaged -p 9000:9000 imaged

.PHONY: stop
stop:
	@docker stop imaged

.PHONY: test
test: build
	@docker run -i --rm --name imagedtest --network host imagedbuilder npm run test
