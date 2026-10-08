# syntax=docker/dockerfile:1
# Final container image
ARG IMAGE_BASE=alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
FROM ${IMAGE_BASE} AS image-base

FROM --platform=${BUILDPLATFORM} golang:1.27.0@sha256:4013ae0f9e7994f8535c58c811f8f863fbed38b72e0d51e6592156f758d66146 AS backend-build
WORKDIR /headlamp

ARG TARGETOS
ARG TARGETARCH
ENV GOPATH=/go \
    GOPROXY=https://proxy.golang.org \
    GO111MODULE=on\
    CGO_ENABLED=0\ 
    GOOS=${TARGETOS}\
    GOARCH=${TARGETARCH}

# Keep go mod download separated so source changes don't trigger install
COPY ./backend/go.* /headlamp/backend/
RUN --mount=type=cache,target=/go/pkg/mod \
    cd ./backend && go mod download

COPY ./backend /headlamp/backend

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    cd ./backend && go build -o ./headlamp-server ./cmd/

FROM --platform=${BUILDPLATFORM} node:25@sha256:78839ac448c23517f8eab2e8f7943d9b4f73979eb7f8bed2c73dbf72ff869e7b AS frontend-build

# Keep npm install separated so source changes don't trigger install
COPY frontend/package*.json /headlamp/frontend/
WORKDIR /headlamp
RUN cd ./frontend && npm ci --only=prod

FROM frontend-build AS frontend
ARG HEADLAMP_SOURCE_COMMIT
ARG HEADLAMP_BUILD_MANIFEST
ENV HEADLAMP_SOURCE_COMMIT=${HEADLAMP_SOURCE_COMMIT} \
    HEADLAMP_BUILD_MANIFEST=${HEADLAMP_BUILD_MANIFEST}

COPY ./frontend /headlamp/frontend

WORKDIR /headlamp

# Expose app metadata and manifests only while generating the frontend build.
RUN --mount=type=bind,source=app,target=/headlamp/app,ro \
    cd ./frontend && npm run build

RUN echo "*** Built Headlamp with version: ***"
RUN cat ./frontend/.env

# Backwards compatibility, move plugin folder to only copy matching plugins.
RUN mv plugins plugins-old || true

# Copy a .plugins folder if it is there to ./plugins, otherwise create an empty one.
# This is a Dockerfile quirky way to copy a folder if it exists, but also not fail if it is empty.
COPY ./.plugi*s ./plugins
RUN mkdir -p ./plugins

# Backwards compatibility, copy any matching plugins found inside "./plugins-old" into "./plugins".
# They should match plugins-old/MyFolder/main.js, otherwise they are not copied.
RUN for i in $(find ./plugins-old/*/main.js); do plugin_name=$(echo $i|cut -d'/' -f3); mkdir -p plugins/$plugin_name; cp $i plugins/$plugin_name; done
RUN for i in $(find ./plugins-old/*/package.json); do plugin_name=$(echo $i|cut -d'/' -f3); mkdir -p plugins/$plugin_name; cp $i plugins/$plugin_name; done

# Static (officially shipped) plugins
FROM --platform=${BUILDPLATFORM} frontend-build AS static-plugins
RUN apt-get update && apt-get install -y jq
COPY ./container/build-manifest.json ./container/fetch-plugins.sh /tools/

WORKDIR /tools
RUN mkdir -p /plugins
RUN ./fetch-plugins.sh /plugins/

FROM image-base AS final

# Create the non-root user
RUN if command -v apt-get > /dev/null; then \
    apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && addgroup --system headlamp \
    && adduser --system --ingroup headlamp headlamp \
    && rm -rf /var/lib/apt/lists/*; \
    else \
    addgroup -S headlamp \
    && adduser -S headlamp -G headlamp; \
    fi

COPY --from=backend-build --link /headlamp/backend/headlamp-server /headlamp/headlamp-server
COPY --from=frontend --link /headlamp/frontend/build /headlamp/frontend
COPY --from=frontend --link /headlamp/plugins /headlamp/plugins
COPY --from=static-plugins --link /plugins /headlamp/static-plugins

RUN chown -R headlamp:headlamp /headlamp
USER headlamp

EXPOSE 4466

ENV HEADLAMP_STATIC_PLUGINS_DIR=/headlamp/static-plugins
ENTRYPOINT ["/headlamp/headlamp-server", "-html-static-dir", "/headlamp/frontend", "-plugins-dir", "/headlamp/plugins"]
