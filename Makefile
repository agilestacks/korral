.DEFAULT_GOAL := lint

export AWS_DEFAULT_REGION ?= us-east-2

DOMAIN_NAME ?= test.dev.superhub.io
NAMESPACE   ?= monitoring

IMAGE_VERSION ?= $(shell git rev-parse HEAD | colrm 7)

HUB_USER  ?= agilestacks
HUB_PASS  ?= ~/.docker/agilestacks.txt
HUB_IMAGE ?= $(HUB_USER)/korral

ECR_REGISTRY ?= $(subst https://,,$(lastword $(shell aws ecr get-login --region $(AWS_DEFAULT_REGION))))
ECR_IMAGE    ?= $(ECR_REGISTRY)/agilestacks/$(DOMAIN_NAME)/korral

kubectl ?= kubectl --context=$(DOMAIN_NAME) --namespace=$(NAMESPACE)
docker  ?= docker
aws     ?= aws

deploy: build push kubernetes

build:
	@$(docker) build -t $(HUB_IMAGE):$(IMAGE_VERSION) .
.PHONY: build

push:
	$(aws) ecr get-login --region $(AWS_DEFAULT_REGION) --no-include-email | $(SHELL) -
	$(docker) tag  $(HUB_IMAGE):$(IMAGE_VERSION) $(ECR_IMAGE):$(IMAGE_VERSION)
	$(docker) tag  $(HUB_IMAGE):$(IMAGE_VERSION) $(ECR_IMAGE):latest
	$(docker) push $(ECR_IMAGE):$(IMAGE_VERSION)
	$(docker) push $(ECR_IMAGE):latest
.PHONY: push

kubernetes:
	-$(kubectl) create namespace $(NAMESPACE)
	$(kubectl) apply -f templates/rbac.yaml
	$(kubectl) apply -f templates/deployment.yaml
	$(kubectl) apply -f templates/service.yaml
	-$(kubectl) apply -f templates/servicemonitor.yaml
.PHONY: kubernetes

undeploy:
	-$(kubectl) delete -f templates/servicemonitor.yaml
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

src/prices/aws-ebs.json:
	(echo 'function callback(j) {console.log(JSON.stringify(j))}' && \
		curl http://a0.awsstatic.com/pricing/1/ebs/pricing-ebs.min.js) | \
		node | \
		jq . > $@

src/prices/aws-elb.json:
	(echo 'function callback(j) {console.log(JSON.stringify(j))}' && \
		curl http://a0.awsstatic.com/pricing/1/ec2/pricing-elb.min.js) | \
		node | \
		jq . > $@


push-latest: IMAGE_TAG:=latest
push-latest: login push-version push-tag
.PHONY: push-latest

push-version:
	$(docker) push $(HUB_IMAGE):$(IMAGE_VERSION)
.PHONY: push-version

push-tag:
	$(docker) tag $(HUB_IMAGE):$(IMAGE_VERSION) $(HUB_IMAGE):$(IMAGE_TAG)
	$(docker) push $(HUB_IMAGE):$(IMAGE_TAG)
.PHONY: push-tag

pull-latest:
	docker pull $(HUB_IMAGE):latest
.PHONY: pull-latest

push-stable: pull-latest
	$(MAKE) push-tag IMAGE_VERSION=latest IMAGE_TAG=stable
.PHONY: push-stable

push-stage: pull-latest
	$(MAKE) push-tag IMAGE_VERSION=latest IMAGE_TAG=stage
.PHONY: push-stage

push-preview: pull-latest
	$(MAKE) push-tag IMAGE_VERSION=latest IMAGE_TAG=preview
.PHONY: push-preview

login:
	@touch $(HUB_PASS)
	@echo "Please put Docker Hub password into $(HUB_PASS)"
	cat $(HUB_PASS) | docker login --username agilestacks --password-stdin
.PHONY: login
