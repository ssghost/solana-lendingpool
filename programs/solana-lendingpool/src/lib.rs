use anchor_lang::prelude::*;

declare_id!("Bkkm6zdAUkacHwn5ZiwFjJRSomnbhnszg7UTDf32Dqg4");

#[program]
pub mod solana_lendingpool {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
