# vendor/sia-storage-linux-x64-gnu

Custom-built `sia-storage` NAPI binary for `linux-x64-gnu`. Built from
[`SiaFoundation/sia-sdk-rs`](https://github.com/SiaFoundation/sia-sdk-rs)
at tag `sia_storage_napi/v0.7.0` with the Zen-testnet recovery
probability adjustment so 2-of-6 erasure coding clears the SDK's
client-side redundancy validator (Zen has too few hosts to satisfy
the upstream 0.75 default at any sane shard count).

## What changes

In `sia_storage/src/lib.rs`, the only constant changed:

```diff
- const RECOVERY_PROBABILITY: f64 = 0.75;
+ const RECOVERY_PROBABILITY: f64 = 0.90;
```

Same constant indexd uses for its server-side slab health validator;
both must move together. The mainnet-bound build will revert to 0.75
once we cut over to a host pool that supports it.

## How it gets used

The default image uses the npm-published binary. Build with
`--build-arg SIA_STORAGE_NATIVE=sia-storage-linux-x64-gnu/sia-storage.node`
(docker-compose.server.yml does) and the Dockerfile copies this file over the
published one; the build fails if the named file is missing. Local Mac
dev still uses the published `darwin-arm64` package — patching only
matters when the SDK's own validator would reject our 2-of-6 config
(it doesn't on macOS dev because we're not actually uploading from
there in normal flow).

## Rebuild

On a host with Docker:

```sh
git clone https://github.com/SiaFoundation/sia-sdk-rs
cd sia-sdk-rs && git checkout sia_storage_napi/v0.7.0
sed -i 's/const RECOVERY_PROBABILITY: f64 = 0.75;/const RECOVERY_PROBABILITY: f64 = 0.90;/' \
    sia_storage/src/lib.rs
docker run --rm -v "$PWD:/work" -w /work/sia_storage_napi rust:1-bullseye bash -c '
  apt-get update -qq && apt-get install -y -qq curl ca-certificates &&
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&
  apt-get install -y -qq nodejs &&
  npm install -g @napi-rs/cli@3 &&
  npm install &&
  napi build --release --platform --esm -o examples
'
cp sia_storage_napi/examples/sia-storage.linux-x64-gnu.node \
   /path/to/siastream/backend/vendor/sia-storage-linux-x64-gnu/sia-storage.node
```
