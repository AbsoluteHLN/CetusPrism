# Linux build image for the CetusPrism desktop shell (.deb leg).
# Built once on the host (`docker build -f docker/linux-build.Dockerfile -t
# cetusprism/linux-build .` from apps/electron), then every build runs in it
# with the workspace, the cargo registry cache, a Linux target dir, and the
# Linux Node runtime mounted in. Debian bookworm pins the glibc the shipped
# binary requires (Debian 12+, Ubuntu 24.04+).
FROM docker.io/library/rust:1-bookworm

ENV DEBIAN_FRONTEND=noninteractive
# libwebkit2gtk-4.1 + libgtk-3: the Tauri/Wry webview stack. libayatana-appindicator:
# the tray icon. librsvg: icon decoding. xdg-utils: xdg-open at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libwebkit2gtk-4.1-dev \
       libgtk-3-dev \
       libayatana-appindicator3-dev \
       librsvg2-dev \
       patchelf \
       pkg-config \
       build-essential \
       libssl-dev \
       file \
       xdg-utils \
    && rm -rf /var/lib/apt/lists/*
