use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Bkkm6zdAUkacHwn5ZiwFjJRSomnbhnszg7UTDf32Dqg4");

#[program]
pub mod solana_lendingpool {
    use super::*;

    pub fn init_bank(ctx: Context<InitBank>, liquidation_threshold: u64, max_ltv: u64, interest_rate: u64) -> Result<()> {
        let bank = &mut ctx.accounts.bank;

        bank.authority = ctx.accounts.signer.key(); 
        bank.mint = ctx.accounts.mint.key();
        bank.bank_token_account = ctx.accounts.bank_token_account.key();

        bank.total_deposits = 0;
        bank.total_borrowed = 0;
        bank.liquidation_threshold = liquidation_threshold; 
        bank.max_ltv = max_ltv;

        bank.interest_rate = interest_rate;
        let clock = Clock::get()?; 
        bank.last_updated = clock.unix_timestamp;

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

        bank.process_interest()?;
        token::transfer(cpi_ctx, amount)?;
        bank.total_deposits += amount;
        user_account.deposit_amount += amount;
        
        if user_account.owner == Pubkey::default() {
            user_account.owner = ctx.accounts.signer.key();
        }

        msg!("Deposit successful! Amount: {}", amount);
        Ok(())
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        let bank = &mut ctx.accounts.bank;
        let user_account = &mut ctx.accounts.user_account;
        let max_borrowable = (user_account.deposit_amount * bank.max_ltv) / 100;

        bank.process_interest()?;        
        if user_account.borrowed_amount + amount > max_borrowable {
             return err!(ErrorCode::OverLTV);
        }

        let bank_balance = ctx.accounts.bank_token_account.amount;
        if amount > bank_balance {
            return err!(ErrorCode::InsufficientFunds);
        }
        let mint_key = ctx.accounts.mint.key();
        let signer_seeds: &[&[&[u8]]] = &[
            &[
                b"bank",
                mint_key.as_ref(),
                &[ctx.bumps.bank], 
            ],
        ];

        let cpi_accounts = Transfer {
            from: ctx.accounts.bank_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: bank.to_account_info(), 
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token::transfer(cpi_ctx, amount)?;
        bank.total_borrowed += amount;
        user_account.borrowed_amount += amount;

        msg!("Borrowed: {}", amount);
        Ok(())
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        let bank = &mut ctx.accounts.bank;

        bank.process_interest()?;
        if amount > user_account.borrowed_amount {
            return err!(ErrorCode::OverRepay);
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.bank_token_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;
        user_account.borrowed_amount -= amount;
        bank.total_borrowed -= amount;

        msg!("Repaid successfully: {}", amount);
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

#[derive(Accounts)]
pub struct Borrow<'info> {
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
        mut,
        seeds = [b"user", signer.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
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
        mut,
        seeds = [b"user", signer.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Bank {
    pub authority: Pubkey,
    pub total_deposits: u64, 
    pub total_borrowed: u64, 
    pub mint: Pubkey,
    pub bank_token_account: Pubkey,
    pub liquidation_threshold: u64, 
    pub max_ltv: u64,
    pub interest_rate: u64, 
    pub last_updated: i64,
}

impl Bank {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8;

    pub fn process_interest(&mut self) -> Result<()> {
        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let time_elapsed = current_time - self.last_updated;

        if time_elapsed > 0 {
            let interest = (self.total_borrowed as u128)
                .checked_mul(self.interest_rate as u128).unwrap()
                .checked_mul(time_elapsed as u128).unwrap()
                .checked_div(10000).unwrap()
                .checked_div(31536000).unwrap();

            self.total_borrowed = self.total_borrowed.checked_add(interest as u64).unwrap();
            self.total_deposits = self.total_deposits.checked_add(interest as u64).unwrap();
            self.last_updated = current_time;
        }
        Ok(())
    }
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

#[error_code]
pub enum ErrorCode {
    #[msg("User does not have enough collateral to borrow this amount.")]
    OverLTV,
    #[msg("Bank does not have enough funds.")]
    InsufficientFunds,
    #[msg("Repayment amount exceeds borrowed amount.")]
    OverRepay,
}