import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaLendingpool } from "../target/types/solana_lendingpool";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";

describe("DeFi Simulation (Basic Mode)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaLendingpool as Program<SolanaLendingpool>;

  const mintKeypair = anchor.web3.Keypair.generate();
  const user = provider.wallet;
  let userTokenAccount: anchor.web3.PublicKey;
  const priceFeedKeypair = anchor.web3.Keypair.generate();

  const [bankPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bank"), mintKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [bankTokenAccount] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), mintKeypair.publicKey.toBuffer()],
    program.programId
  );
  const [userAccountPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), user.publicKey.toBuffer()],
    program.programId
  );

  const log = (msg: string) => console.log(`\x1b[36m${msg}\x1b[0m`);
  const logSuccess = (msg: string) => console.log(`\x1b[32m${msg}\x1b[0m`);
  const logError = (msg: string) => console.log(`\x1b[31m${msg}\x1b[0m`);

  it("Setup Simulation Environment", async () => {
    console.log("\nInitializing Basic Simulation Environment...");

    try {
      await createMint(
        provider.connection,
        (user as any).payer,
        user.publicKey,
        null,
        6,
        mintKeypair
      );
      log(`Mint created: ${mintKeypair.publicKey.toString().slice(0, 6)}...`);

      const userAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        (user as any).payer,
        mintKeypair.publicKey,
        user.publicKey
      );
      userTokenAccount = userAta.address;
      log(`User ATA created: ${userTokenAccount.toString().slice(0, 6)}...`);

      await mintTo(
        provider.connection,
        (user as any).payer,
        mintKeypair.publicKey,
        userTokenAccount,
        user.publicKey,
        10000 * 1000000
      );
      logSuccess("Minted 10,000 USDC to User");

    } catch (e) {
      logError("Setup failed (Check if @solana/spl-token is installed): " + e);
    }
  });

  it("Initialize Protocol and Oracle", async () => {
    try {
      await program.methods.initBank(new anchor.BN(50), new anchor.BN(80), new anchor.BN(500))
        .accounts({
          // @ts-ignore
          bank: bankPda,
          mint: mintKeypair.publicKey,
          bankTokenAccount: bankTokenAccount,
          signer: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId
        })
        .rpc();
      logSuccess("Bank Initialized (with Interest Rate)");

      await program.methods.initPriceFeed(new anchor.BN(10), 6)
        .accounts({
            priceFeed: priceFeedKeypair.publicKey,
            signer: user.publicKey,
            // @ts-ignore
            systemProgram: anchor.web3.SystemProgram.programId
        })
        .signers([priceFeedKeypair])
        .rpc();
      logSuccess("Oracle Initialized (Price: $10)");
    } catch (e) {
      log(`Bank init skipped or failed: ${e}`);
    }
  });

  it("Run Basic Simulation", async () => {
    console.log("\nStarting Live Simulation... (Press Ctrl+C to stop)\n");
    try {
        const initialDeposit = new anchor.BN(100);
        console.log(`Opening Account: Initial Deposit of ${initialDeposit.toString()} USDC...`);
        
        await program.methods.deposit(initialDeposit).accounts({
            // @ts-ignore
            bank: bankPda,
            bankTokenAccount: bankTokenAccount,
            mint: mintKeypair.publicKey,
            userTokenAccount: userTokenAccount,
            userAccount: userAccountPda,
            signer: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID
        }).rpc();
        logSuccess("Account Opened & Initial Deposit Success");
    } catch (e) {
        logError(`Initial Deposit Failed: ${e}`);
    }
    let counter = 0;
    while (true) {
      counter++;
      console.log(`\n--- Block Simulation #${counter} ---`);
      const action = Math.floor(Math.random() * 6);
      const amount = new anchor.BN(Math.floor(Math.random() * 50) + 10); 

      try {
        if (action === 0) {
          log(`User depositing ${amount.toString()} USDC...`);
          await program.methods.deposit(amount).accounts({
            // @ts-ignore
            bank: bankPda,
            bankTokenAccount: bankTokenAccount,
            mint: mintKeypair.publicKey,
            userTokenAccount: userTokenAccount,
            userAccount: userAccountPda,
            signer: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID
          }).rpc();
          logSuccess("Deposit Success");
        }
        else if (action === 1) {
          log(`User borrowing ${amount.toString()} USDC...`);
          await program.methods.borrow(amount).accounts({
            // @ts-ignore
            bank: bankPda,
            bankTokenAccount: bankTokenAccount,
            mint: mintKeypair.publicKey,
            userTokenAccount: userTokenAccount,
            userAccount: userAccountPda,
            signer: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceFeed: priceFeedKeypair.publicKey
          }).rpc();
          logSuccess("Borrow Success");
        }
        else if (action === 2){
          log(`User repaying ${amount.toString()} USDC...`);
          await program.methods.repay(amount).accounts({
            // @ts-ignore
            bank: bankPda,
            bankTokenAccount: bankTokenAccount,
            mint: mintKeypair.publicKey,
            userAccount: userAccountPda,
            userTokenAccount: userTokenAccount,
            signer: user.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID
          }).rpc();
          logSuccess("Repay Success");
        }
        else if (action === 3) { 
          const newPrice = Math.floor(Math.random() * 20); 
          const safePrice = newPrice === 0 ? 1 : newPrice; 
          log(`Oracle updating price to $${safePrice}...`);
          await program.methods.setPrice(new anchor.BN(safePrice)).accounts({
            priceFeed: priceFeedKeypair.publicKey,
            // @ts-ignore
            authority: user.publicKey,
          }).rpc();
          logSuccess(`Price Updated to $${safePrice}`);
        }
        else if (action == 4) { 
          log("Attempting Liquidation check...");
           await program.methods.liquidate(new anchor.BN(5)).accounts({
              // @ts-ignore
              bank: bankPda,
              bankTokenAccount: bankTokenAccount,
              mint: mintKeypair.publicKey,
              liquidatorTokenAccount: userTokenAccount,
              liquidator: user.publicKey,
              userTokenAccount: userTokenAccount,
              userAccount: userAccountPda,
              user: user.publicKey,
              priceFeed: priceFeedKeypair.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
           }).rpc();
           logSuccess("Liquidation Executed! Collateral Seized.");
        }
        else {
          log(`User withdrawing ${amount.toString()} Tokens...`);
           await program.methods.withdraw(amount).accounts({
              // @ts-ignore
              bank: bankPda,
              bankTokenAccount: bankTokenAccount,
              mint: mintKeypair.publicKey,
              userTokenAccount: userTokenAccount,
              userAccount: userAccountPda,
              priceFeed: priceFeedKeypair.publicKey, 
              signer: user.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
           }).rpc();
           logSuccess("Withdraw Success");
        }
        const bankState = await program.account.bank.fetch(bankPda);
        console.log(`Vault: ${bankState.totalDeposits.toString()} | Borrowed: ${bankState.totalBorrowed.toString()}`);
      } catch (e: any) {
        if (e.message.includes("NotUndercollateralized") || e.message.includes("6004")) {console.log("Liquidation Check: Position Healthy, Liquidation Rejected");}
        else if (e.message.includes("OverLTV")) logError("Action Rejected: Over LTV (Borrow or Withdraw blocked to maintain solvency)");
        else if (e.message.includes("InsufficientFunds")) logError("Rejected: Not enough funds");
        else if (e.message.includes("OverRepay")) logError("Action Rejected: Over Repay (User tried to pay more than debt)")
        else if (e.message.includes("0x1") || e.message.includes("insufficient funds")) logError("Action Rejected: Liquidity Crisis (Bank vault is empty)");
        else logError(`Transaction Failed: ${e.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  });
});