FROM node:20.11-bookworm-slim AS node-image
FROM python:3.13.2-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
        bzip2 ccache f2c g++ gfortran git make \
        patch pkg-config swig unzip wget xz-utils \
        autoconf autotools-dev automake texinfo dejagnu \
        build-essential libltdl-dev \
        gnupg2 libdbus-glib-1-2 sudo sqlite3 \
        ninja-build jq cmake bison \
  && rm -rf /var/lib/apt/lists/*

COPY --from=node-image /usr/local/bin/node /usr/local/bin/
COPY --from=node-image /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN wget https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.9.tar.gz \
    && tar -xzf 4.0.9.tar.gz \
    && cd emsdk-4.0.9 \
    && ./emsdk install 4.0.9 \
    && ./emsdk activate 4.0.9 \
    && cd .. \
    && mv emsdk-4.0.9 /opt/emsdk \
    && rm 4.0.9.tar.gz

RUN python -m pip install --upgrade pip wheel pyodide-build==0.30.5
