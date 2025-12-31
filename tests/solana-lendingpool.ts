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

  const priceFeedKeypair = anchor.web3.Keypair.generate(); 
  const liquidatorKeypair = anchor.web3.Keypair.generate(); 
  let liquidatorTokenAccount: anchor.web3.PublicKey;

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
    console.log("Minted 1000 USDC to User.");

    liquidatorTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      liquidatorKeypair.publicKey
    );

    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      liquidatorTokenAccount,
      provider.wallet.publicKey, 
      initialBalance 
    );
    console.log("Minted 1000 USDC to Liquidator.");
  });

  it("Initialize Bank and Oracle", async () => {
    [bankPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bank"), mint.toBuffer()],
      program.programId
    );

    [bankTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), mint.toBuffer()],
      program.programId
    );

    await program.methods
      .initBank(new anchor.BN(50), new anchor.BN(80), new anchor.BN(500)) 
      .accounts({
        // @ts-ignore
        bank: bankPda,
        mint: mint,
        bankTokenAccount: bankTokenAccount,
        signer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .rpc();
    
    console.log("Bank Initialized.");

    await program.methods
      .initPriceFeed(new anchor.BN(10), 6) 
      .accounts({
          priceFeed: priceFeedKeypair.publicKey,
          signer: provider.wallet.publicKey,
          // @ts-ignore
          systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([priceFeedKeypair])
      .rpc();
    console.log("Oracle Initialized with Price: $10");
  });

  it("Deposit USDC", async () => {
    [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .deposit(depositAmount)
      .accounts({
        // @ts-ignore
        bank: bankPda,
        signer: provider.wallet.publicKey,
        bankTokenAccount: bankTokenAccount,
        mint: mint,
        userTokenAccount: userTokenAccount,
        userAccount: userAccountPda,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .rpc();

    console.log("Deposit 100 USDC submitted, verifying state...");

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

  it("Borrow USDC", async () => {
    const borrowAmount = new anchor.BN(60_000_000);

    await program.methods
      .borrow(borrowAmount)
      .accounts({
        // @ts-ignore
        bank: bankPda,
        bankTokenAccount: bankTokenAccount,
        mint: mint,
        userTokenAccount: userTokenAccount,
        userAccount: userAccountPda,
        signer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        priceFeed: priceFeedKeypair.publicKey
      })
      .rpc();

    console.log("Borrow transaction submitted, verifying state...");

    const bankTokenBalance = await provider.connection.getTokenAccountBalance(bankTokenAccount);
    assert.equal(bankTokenBalance.value.amount, "40000000"); 
    console.log("Bank vault balance verified: 40,000,000");

    const userTokenBalance = await provider.connection.getTokenAccountBalance(userTokenAccount);
    assert.equal(userTokenBalance.value.amount, "960000000");
    console.log("User wallet balance verified: 960,000,000");

    const bankState = await program.account.bank.fetch(bankPda);
    assert.ok(bankState.totalBorrowed.eq(borrowAmount)); 
    assert.ok(bankState.totalDeposits.eq(new anchor.BN(100000000))); 
    console.log("Bank state verified: Total Borrowed = 500");

    const userState = await program.account.userAccount.fetch(userAccountPda);
    assert.ok(userState.borrowedAmount.eq(borrowAmount)); 
    console.log("User state verified: Borrowed Amount = 500");
  });

  it("Repay USDC", async () => {
    const repayAmount = new anchor.BN(200);

    await program.methods
      .repay(repayAmount)
      .accounts({
        // @ts-ignore
        bank: bankPda,
        userAccount: userAccountPda,
        bankTokenAccount: bankTokenAccount,
        mint: mint,
        userTokenAccount: userTokenAccount,
        signer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Repay transaction submitted, verifying state...");

    const bankTokenBalance = await provider.connection.getTokenAccountBalance(bankTokenAccount);
    assert.equal(bankTokenBalance.value.amount, "40000200");
    console.log("Bank vault balance verified: 40,000,200");

    const userTokenBalance = await provider.connection.getTokenAccountBalance(userTokenAccount);
    assert.equal(userTokenBalance.value.amount, "959999800");
    console.log("User wallet balance verified: 959,999,800");

    const userState = await program.account.userAccount.fetch(userAccountPda);
    assert.ok(userState.borrowedAmount.eq(new anchor.BN(59999800)));
    console.log("User state verified: Remaining Debt = 59,999,800");

    const bankState = await program.account.bank.fetch(bankPda);
    assert.ok(bankState.totalBorrowed.eq(new anchor.BN(59999800)));
    console.log("Bank state verified: Total Borrowed = 59,999,800");
  });

  it("Liquidate (Market Crash)", async () => {
    console.log("Simulating Market Crash...");
    await program.methods
        .setPrice(new anchor.BN(1)) 
        .accounts({
            priceFeed: priceFeedKeypair.publicKey,
            // @ts-ignore
            authority: provider.wallet.publicKey,
        })
        .rpc();
    console.log("Price updated to $0.1");

    const liquidateAmount = new anchor.BN(5); 
    console.log("Liquidator stepping in...");

    await program.methods
        .liquidate(liquidateAmount)
        .accounts({
            // @ts-ignore
            bank: bankPda,
            bankTokenAccount: bankTokenAccount,
            mint: mint,
            liquidatorTokenAccount: liquidatorTokenAccount, 
            liquidator: liquidatorKeypair.publicKey,        
            userTokenAccount: userTokenAccount,             
            userAccount: userAccountPda,                    
            user: provider.wallet.publicKey,                
            priceFeed: priceFeedKeypair.publicKey,         
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([liquidatorKeypair]) 
        .rpc();

    console.log("Liquidation completed");
  });
});