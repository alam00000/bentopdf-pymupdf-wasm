# Build Instructions for PyMuPDF WASM

These files constitute the "Corresponding Source" build scripts required by the AGPL license.

## Prerequisites

- Docker
- Git

## Build Steps

1.  **Build with Docker**:
    The build process is containerized. Use the provided `Dockerfile` to build the WASM artifacts.

    ```bash
    docker build -t pymupdf-wasm-build .
    ```

    This will compile PyMuPDF to WebAssembly using Emscripten within the container.

2.  **Extract Artifacts**:
    After building, you can extract the `pymupdf.wasm` and generated JS files from the container.

    ```bash
    docker run --rm -v $(pwd)/dist:/output pymupdf-wasm-build cp -r /app/dist/* /output/
    ```

## File Descriptions

-   `Dockerfile`: Defines the build environment and steps for compiling PyMuPDF to WASM.
-   `scripts/`: Helper scripts used during the build process.
