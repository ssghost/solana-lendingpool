import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaLendingpool } from "../target/types/solana_lendingpool";
import { assert } from "chai";

describe("solana_lendingpool", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaLendingpool as Program<SolanaLendingpool>;
  let bankPda: anchor.web3.PublicKey;
  
  it("Bank Initialized!", async () => {
    [bankPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bank")],
      program.programId
    );
    const tx = await program.methods
      .initBank()
      .accounts({
        bank: bankPda,
        signer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Your transaction signature", tx);
    const bankAccount = await program.account.bank.fetch(bankPda);
    console.log("Bank Authority:", bankAccount.authority.toBase58());
    console.log("Total Deposits:", bankAccount.totalDeposits.toString());
    assert.ok(bankAccount.totalDeposits.eq(new anchor.BN(0)), "Deposits should be 0");
    assert.ok(bankAccount.authority.equals(provider.wallet.publicKey), "Authority should be me");
  });
});