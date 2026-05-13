# Verifiable Builds

This repo should be able to prove that a deployed Solana program matches a
specific source commit.

## Local Build

```bash
npm run verify:ci
anchor build
npm run verify:hashes
```

`verify:hashes` lists local `target/deploy/*.so` artifacts and prints the
hash comparison commands.

## Deterministic Build

Install the Solana verification tool:

```bash
cargo install solana-verify
```

Build with a deterministic image matched to the Solana/Anchor toolchain used
for the release:

```bash
solana-verify build -b solanafoundation/solana-verifiable-build:1.18.16
```

Get the hash of a local artifact:

```bash
solana-verify get-executable-hash target/deploy/<program>.so
```

Get the hash of a deployed program:

```bash
solana-verify get-program-hash -u <cluster-url> <program-id>
```

The two hashes must match before a deployment is described as verifiably built.

## Release Record

For every deployed release, record:

- source commit hash
- Anchor version
- Solana CLI version
- docker image used for deterministic build
- program artifact filename
- local executable hash
- deployed program ID
- deployed program hash

Store final records in `audits/README.md` or a dated file under `audits/`.
