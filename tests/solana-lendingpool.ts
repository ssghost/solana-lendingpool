import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaLendingpool } from "../target/types/solana_lendingpool";
import { 
  createMint, 
  createAssociatedTokenAccount, 
  mintTo, 
  getAccount 
} from "@solana/spl-token";
import { assert } from "chai";

describe("solana_lendingpool", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaLendingpool as Program<SolanaLendingpool>;

  let mint: anchor.web3.PublicKey;
  let bankPda: anchor.web3.PublicKey;
  let bankTokenAccount: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;
  let userAccountPda: anchor.web3.PublicKey;

  const initialBalance = 1000_000_000; 
  const depositAmount = new anchor.BN(100_000_000); 

  it("Setup Mint and Accounts", async () => {
    mint = await createMint(
      provider.connection,
      provider.wallet.payer, 
      provider.wallet.publicKey, 
      null, 
      6 
    );
    console.log("Mint created:", mint.toBase58());

    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      provider.wallet.publicKey
    );

    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      userTokenAccount,
      provider.wallet.publicKey,
      initialBalance
    );
    console.log("Minted 1000 USDC to User");
  });

  it("Initialize Bank", async () => {
    [bankPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bank"), mint.toBuffer()],
      program.programId
    );

    [bankTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .initBank(new anchor.BN(5000), new anchor.BN(8000)) 
      .accounts({
        // @ts-ignore
        bank: bankPda,
        mint: mint,
        bankTokenAccount: bankTokenAccount,
        signer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log("Bank Initialized!");
  });

  it("Deposit USDC", async () => {
    [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .deposit(depositAmount)
      .accounts({
        signer: provider.wallet.publicKey,
        // @ts-ignore
        bank: bankPda,
        bankTokenAccount: bankTokenAccount,
        mint: mint,
        userTokenAccount: userTokenAccount,
        userAccount: userAccountPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Deposit 100 USDC successful!");

    const bankTokenBalance = await provider.connection.getTokenAccountBalance(bankTokenAccount);
    assert.equal(bankTokenBalance.value.amount, depositAmount.toString());
    console.log("Vault balance verified:", bankTokenBalance.value.uiAmount);

    const bankState = await program.account.bank.fetch(bankPda);
    assert.ok(bankState.totalDeposits.eq(depositAmount));
    console.log("Bank total deposits verified:", bankState.totalDeposits.toString());

    const userState = await program.account.userAccount.fetch(userAccountPda);
    assert.ok(userState.depositAmount.eq(depositAmount));
    console.log("User deposit record verified:", userState.depositAmount.toString());
  });
});