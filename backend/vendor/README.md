# backend/vendor

Optional, custom-built native modules for `@siafoundation/sia-storage`. Nothing here is needed for a normal deployment: the image uses the published module on x86-64 and compiles the same release from source on ARM64.

A custom module is only useful when the SDK itself has to behave differently, for example on the Zen testnet, whose host pool is too small for the SDK's redundancy rules at low shard counts.

## Using one

Put the file under this directory and name it with the `SIA_STORAGE_NATIVE` build argument, relative to `backend/vendor/`:

```sh
SIA_STORAGE_NATIVE=sia-storage-linux-x64-gnu/sia-storage.node docker compose build backend
```

The Dockerfile copies it over the module the SDK loads, and the build fails if the file is missing. Files here are gitignored except this readme.

## Building one for Zen

Before accepting a slab, the SDK checks that its shards give at least a 99.99% chance of recovery, assuming each host stays available with probability 0.75. Few ratios pass that on a pool of a dozen hosts (see the production guide). Raising the assumed availability to 0.90 lets ratios like 2 data + 4 parity through. indexd runs the same check before pinning, so an indexd built with the same change is needed too.

The module has to match the `@siafoundation/sia-storage` version the backend installs (0.1.5, built from the `sia_storage_napi/v0.11.1` tag). For linux x86-64:

```sh
git clone --depth 1 --branch sia_storage_napi/v0.11.1 https://github.com/SiaFoundation/sia-sdk-rs
cd sia-sdk-rs
# in UploadOptions::validate(); perl -pi works with both gnu and bsd (macos) tools
perl -pi -e 's/const RECOVERY_PROBABILITY: f64 = 0\.75;/const RECOVERY_PROBABILITY: f64 = 0.90;/' sia_storage/src/lib.rs
docker run --rm --platform linux/amd64 -v "$PWD:/src" -w /src rust:1-trixie \
  cargo build --release -p sia_storage_napi
mkdir -p /path/to/Sluby/backend/vendor/sia-storage-linux-x64-gnu
cp target/release/libsia_storage_napi.so \
  /path/to/Sluby/backend/vendor/sia-storage-linux-x64-gnu/sia-storage.node
```

Build on the same architecture as the server; for ARM64 drop `--platform` on an ARM64 machine and name the directory `sia-storage-linux-arm64-gnu`.
