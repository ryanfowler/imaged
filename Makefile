.PHONY: all build

all:
	@echo "imaged"
	@echo "make <cmd>"
	@echo ""
	@echo "commands:"
	@echo "  build       - build the docker container"
	@echo "  lint        - run eslint"
	@echo "  run         - run the service in a docker container"
	@echo "  test        - run tests in a docker container"

build:
	@docker build -f build/Dockerfile -t imaged .
	@docker build -f build/Dockerfile -t imagedbuilder --target builder .

lint: build
	@docker run -i --rm --name imaged imagedbuilder npm run lint

run: build
	@docker run -it --rm --env-file .env --name imaged -p 9000:9000 imaged

test: build
	@docker run -i --rm --name imaged imagedbuilder npm run test
