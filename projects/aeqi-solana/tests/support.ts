import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

export async function fundKeypair(
  provider: anchor.AnchorProvider,
  lamports = 2 * anchor.web3.LAMPORTS_PER_SOL,
) {
  const kp = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(kp.publicKey, lamports);
  const latest = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction(
    { signature: sig, ...latest },
    "confirmed",
  );
  return kp;
}

export async function expectTxFail(
  run: () => Promise<unknown>,
  pattern: RegExp | string,
) {
  try {
    await run();
  } catch (e: any) {
    const message = String(e);
    if (typeof pattern === "string") {
      expect(message).to.include(pattern);
    } else {
      expect(message).to.match(pattern);
    }
    return;
  }

  throw new Error(`expected transaction failure matching ${pattern}`);
}
