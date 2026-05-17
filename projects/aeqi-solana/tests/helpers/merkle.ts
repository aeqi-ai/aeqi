/**
 * Sorted-pair Merkle tree helper for token-vote snapshots (ae-008).
 *
 * Mirrors the on-chain `aeqi_governance::verify_merkle_proof` and the
 * off-chain `aeqi-indexer::snapshot::compute_merkle_root` exactly:
 *
 *   - Leaf encoding: `sha256(voter_pubkey || u64_le(balance))`
 *   - Parent: `sha256(min(a, b) || max(a, b))` at every layer
 *   - Odd-trailing element promotes unchanged
 *   - Single-leaf tree: root == leaf, proof is empty
 *
 * Drift between the three implementations is the most subtle way to
 * break token voting (proofs look fine, just never validate). When you
 * change one, change the other two.
 */
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

export interface MerkleLeaf {
  holder: PublicKey;
  balance: bigint;
}

export interface MerkleTree {
  root: Uint8Array;
  leaves: Uint8Array[];
  /** Holders in the same order as `leaves`, so callers can look up
   * proofs by index when they iterate the original holder list. */
  holders: PublicKey[];
}

function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

function u64Le(value: bigint): Uint8Array {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return new Uint8Array(buf);
}

/** Mirror of `aeqi_governance::token_vote_leaf`. */
export function tokenVoteLeaf(holder: PublicKey, balance: bigint): Uint8Array {
  return sha256(new Uint8Array(holder.toBuffer()), u64Le(balance));
}

/** Lexicographic compare over two equal-length byte arrays. */
function lexLess(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false; // equal → return false so `<=` semantics fall through to "a <= b = true"
}

function lexLeq(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return true;
}

function pairHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  return lexLeq(a, b) ? sha256(a, b) : sha256(b, a);
}

/**
 * Build a sorted-pair Merkle tree over the holder list. Holders are
 * sorted by pubkey first (deterministic across snapshotters), then
 * leaves are hashed in that order.
 */
export function buildMerkleTree(input: MerkleLeaf[]): MerkleTree {
  if (input.length === 0) {
    throw new Error("buildMerkleTree: empty holder list");
  }
  // Defensive copy + sort by holder pubkey bytes.
  const holders = [...input].sort((a, b) => {
    const bytesA = a.holder.toBuffer();
    const bytesB = b.holder.toBuffer();
    for (let i = 0; i < 32; i++) {
      if (bytesA[i] !== bytesB[i]) return bytesA[i] - bytesB[i];
    }
    return 0;
  });
  const leaves = holders.map((h) => tokenVoteLeaf(h.holder, h.balance));
  const root = computeRoot(leaves);
  return { root, leaves, holders: holders.map((h) => h.holder) };
}

function computeRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 1) return leaves[0];
  let layer = leaves;
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(pairHash(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Build the Merkle proof for `holder` (must appear in `tree.holders`).
 * Returns an empty array when the tree has a single leaf — the on-chain
 * verifier accepts root == leaf in that case.
 */
export function merkleProof(tree: MerkleTree, holder: PublicKey): Uint8Array[] {
  const idx = tree.holders.findIndex((h) => h.equals(holder));
  if (idx < 0) {
    throw new Error(
      `merkleProof: holder ${holder.toBase58()} not in tree (size=${tree.holders.length})`,
    );
  }
  return proofForIndex(tree.leaves, idx);
}

function proofForIndex(leaves: Uint8Array[], targetIdx: number): Uint8Array[] {
  if (leaves.length === 1) return [];
  const layers: Uint8Array[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 < prev.length) {
        next.push(pairHash(prev[i], prev[i + 1]));
      } else {
        next.push(prev[i]);
      }
    }
    layers.push(next);
  }
  const proof: Uint8Array[] = [];
  let idx = targetIdx;
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const siblingIdx = idx ^ 1;
    if (siblingIdx < layer.length) {
      proof.push(layer[siblingIdx]);
    }
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Off-chain mirror of `aeqi_governance::verify_merkle_proof`. Used by
 * tests to assert their own constructed proofs match before submitting
 * to the chain — debugging an unexpected on-chain rejection is much
 * faster when you can rule out a malformed proof locally.
 */
export function verifyMerkleProof(
  leaf: Uint8Array,
  proof: Uint8Array[],
  root: Uint8Array,
): boolean {
  let current = leaf;
  for (const sibling of proof) {
    current = pairHash(current, sibling);
  }
  return Buffer.compare(current, root) === 0;
}

// `lexLess` is exported in case downstream callers want the strict
// comparator separately; suppress unused warning otherwise.
void lexLess;
