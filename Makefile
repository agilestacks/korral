.DEFAULT_GOAL := lint

export AWS_DEFAULT_REGION ?= us-east-2

DOMAIN_NAME   ?= test.dev.superhub.io
REGISTRY      ?= $(subst https://,,$(lastword $(shell aws ecr get-login --region $(AWS_DEFAULT_REGION))))
IMAGE         ?= $(REGISTRY)/agilestacks/$(DOMAIN_NAME)/korral
IMAGE_VERSION ?= $(shell git rev-parse HEAD | colrm 7)
NAMESPACE     ?= monitoring

kubectl       ?= kubectl --context=$(DOMAIN_NAME) --namespace=$(NAMESPACE)
docker        ?= docker
aws           ?= aws

build:
	@ $(docker) build -t $(IMAGE):$(IMAGE_VERSION) .
.PHONY: build

push:
	$(aws) ecr get-login --region $(AWS_DEFAULT_REGION) --no-include-email | $(SHELL) -
	$(docker) tag  $(IMAGE):$(IMAGE_VERSION) $(IMAGE):latest
	$(docker) push $(IMAGE):$(IMAGE_VERSION)
	$(docker) push $(IMAGE):latest
.PHONY: push

deploy: build push
	-$(kubectl) create namespace $(NAMESPACE)
	$(kubectl) apply -f templates/rbac.yaml
	$(kubectl) apply -f templates/deployment.yaml
	$(kubectl) apply -f templates/service.yaml
.PHONY: deploy

undeploy:
	-$(kubectl) delete -f templates/service.yaml
	-$(kubectl) delete -f templates/deployment.yaml
	-$(kubectl) delete -f templates/rbac.yaml
.PHONY: undeploy

install:
	@npm install
.PHONY: install

lint:
	@npm run lint
.PHONY: lint

test:
	@npm test
.PHONY: test

run:
	@npm start
.PHONY: run