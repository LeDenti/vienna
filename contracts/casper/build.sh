#!/bin/sh
# Build vienna_escrow.wasm (the contract, installed once) and vienna_lock.wasm (the renter's session) into build/.
# Casper's VM (casper-wasmi) accepts wasm MVP only: rustc ≥ 1.82 emits bulk-memory and sign-extension ops by default,
# so wasm-opt lowers them back, then validates with every post-MVP feature disabled.
set -eu
cd "$(dirname "$0")/vienna_escrow"
cargo build --release --target wasm32-unknown-unknown -p vienna_escrow -p vienna_lock
for name in vienna_escrow vienna_lock; do
  wasm-opt -Oz --llvm-memory-copy-fill-lowering --signext-lowering --enable-bulk-memory --enable-sign-ext --enable-mutable-globals \
    target/wasm32-unknown-unknown/release/$name.wasm -o ../build/$name.wasm
  wasm-strip ../build/$name.wasm
  wasm-validate --disable-bulk-memory --disable-sign-extension --disable-multi-value --disable-reference-types \
    --disable-saturating-float-to-int --disable-simd --disable-tail-call --disable-exceptions ../build/$name.wasm
done
cd ../build && shasum -a 256 vienna_escrow.wasm vienna_lock.wasm | tee SHA256SUMS && ls -l *.wasm
