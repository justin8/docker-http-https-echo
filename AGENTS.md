# AI Agent Guidelines: Version Updates and Releases

This document provides instructions for AI coding assistants on how to perform version bumps and manage releases in this repository.

## Steps to Perform a Version Update

When asked to update the version/bump the release tag (e.g., from `42` to `43`):

### 1. Update Version References in Documentation
* Search **[README.md](file:///Users/justindray/src/docker-http-https-echo/README.md)** for all instances of the old version tag (e.g. `:42`) and replace them with the new version tag (e.g. `:43`). 
* Make sure all docker run examples and registry path snippets in the documentation match the new tag.

### 2. Update Orchestration Files
* Open **[docker-compose.yml](file:///Users/justindray/src/docker-http-https-echo/docker-compose.yml)** and update the image tag namespace to match the new version:
  ```yaml
  image: justin8/http-https-echo:<NEW_VERSION>
  ```

### 3. Update the Changelog
* Open **[CHANGELOG.md](file:///Users/justindray/src/docker-http-https-echo/CHANGELOG.md)** and add a new version block at the very top of the file:
  ```markdown
  ## Version `<NEW_VERSION>` - YYYY-MM-DD
  * Brief description of change 1
  * Brief description of change 2
  ```
  *(Format the date as `YYYY-MM-DD` according to the system current local time).*

### 4. Running the Test Suite
* **CRITICAL**: Before committing any changes or creating releases, always verify that the codebase passes the local test suite using your container CLI:
  ```bash
  export DOCKER=container # Or docker
  ./tests.sh
  ```
  *(Never skip this step, as changes to logging formats or startup behavior can break exact line-count assertions in the test suite).*

### 5. Tagging and Publishing the Release
* Once your version changes are committed and pushed to the `main` branch, tag the release and push the tag to trigger the automatic build and publication:
  ```bash
  git tag <NEW_VERSION>
  git push origin <NEW_VERSION>
  ```
  *(For example: `git tag 42 && git push origin 42`)*

---

## CI/CD and Release Mechanisms

Our GitHub workflow **[build-and-publish.yml](file:///Users/justindray/src/docker-http-https-echo/.github/workflows/build-and-publish.yml)** is configured as follows:

* **Commit to `main`**: Automatically builds and publishes the `:latest` image tag to both Docker Hub and GitHub Container Registry.
* **Semantic Tag Release**: Pushing any tag (e.g., `42`) triggers the publication of versioned images (e.g. `:42` and `:v42`).
