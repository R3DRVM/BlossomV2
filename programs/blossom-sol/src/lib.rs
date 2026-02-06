use anchor_lang::prelude::*;

declare_id!("ReplaceWithProgramId1111111111111111111111111");

#[program]
pub mod blossom_sol {
    use super::*;

    pub fn execute_intent(_ctx: Context<ExecuteIntent>, _amount: u64) -> Result<()> {
        // MVP placeholder: intent execution entrypoint.
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteIntent {}
