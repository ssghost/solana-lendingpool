use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Bkkm6zdAUkacHwn5ZiwFjJRSomnbhnszg7UTDf32Dqg4");

#[program]
pub mod solana_lendingpool {
    use super::*;

    pub fn init_bank(ctx: Context<InitBank>, liquidation_threshold: u64, max_ltv: u64) -> Result<()> {
        let bank = &mut ctx.accounts.bank;

        bank.authority = ctx.accounts.signer.key(); 
        bank.mint = ctx.accounts.mint.key();
        bank.bank_token_account = ctx.accounts.bank_token_account.key();

        bank.total_deposits = 0;
        bank.total_borrowed = 0;
        bank.liquidation_threshold = liquidation_threshold; 
        bank.max_ltv = max_ltv;

        msg!("Bank initialized! Authority: {}", bank.authority);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let bank = &mut ctx.accounts.bank;
        let user_account = &mut ctx.accounts.user_account;
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.bank_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;
        bank.total_deposits += amount;
        user_account.deposit_amount += amount;
        
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.signer.key();
        }

        msg!("Deposit successful! Amount: {}", amount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitBank<'info> {
    #[account(
        init,                   
        payer = signer,         
        space = 8 + Bank::INIT_SPACE,
        seeds = [b"bank", mint.key().as_ref()],      
        bump                    
    )]
    pub bank: Account<'info, Bank>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = signer,
        token::mint = mint,
        token::authority = bank,
        seeds = [b"treasury", mint.key().as_ref()],
        bump
    )]
    pub bank_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bank", mint.key().as_ref()],
        bump
    )]
    pub bank: Account<'info, Bank>,

    #[account(
        mut,
        seeds = [b"treasury", mint.key().as_ref()],
        bump
    )]
    pub bank_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_token_account.owner == signer.key(),
        constraint = user_token_account.mint == mint.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed, 
        payer = signer,
        space = 8 + UserAccount::INIT_SPACE,
        seeds = [b"user", signer.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Bank {
    pub authority: Pubkey,
    pub total_deposits: u64, 
    pub total_borrowed: u64, 
    pub mint: Pubkey,
    pub bank_token_account: Pubkey,
    pub liquidation_threshold: u64, 
    pub max_ltv: u64
}

impl Bank {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8;
}

#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub deposit_amount: u64,
    pub borrowed_amount: u64,
    pub bump: u8,
}

impl UserAccount {
    pub const INIT_SPACE: usize = 32 + 8 + 8 + 1;
}
