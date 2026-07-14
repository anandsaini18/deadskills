# deadskills — developer commands
# Usage: make <target>

.DEFAULT_GOAL := help

.PHONY: help install build dev test watch typecheck check run dead json clean link publish-dry release-patch release-minor _release

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: ## Build the CLI to dist/
	npm run build

dev: ## Rebuild on file changes
	npm run dev

test: ## Run tests once
	npm test

watch: ## Run tests in watch mode
	npm run test:watch

typecheck: ## Type-check without emitting
	npm run typecheck

check: typecheck test ## Typecheck + tests (run before committing)

run: build ## Build and run the full report against YOUR ~/.claude
	node dist/cli.js

dead: build ## Build and show only your dead skills
	node dist/cli.js dead

json: build ## Build and print the canonical JSON report
	node dist/cli.js --json

link: build ## npm link so `deadskills` works globally on this machine
	npm link

publish-dry: check build ## Dry-run npm publish (verify package contents)
	npm publish --dry-run

release-patch: ## Bump patch version, commit, tag, push — CI publishes to npm
	$(MAKE) _release BUMP=patch

release-minor: ## Bump minor version, commit, tag, push — CI publishes to npm
	$(MAKE) _release BUMP=minor

_release: check
	@test -z "$$(git status --porcelain -uno)" || { echo "Working tree not clean — commit first."; exit 1; }
	npm version $(BUMP)
	git push origin main --follow-tags

clean: ## Remove build artifacts and node_modules
	rm -rf dist node_modules
