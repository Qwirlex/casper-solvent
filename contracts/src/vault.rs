use odra::casper_types::U256;
use odra::prelude::*;
use odra::ContractRef;

use crate::pay_token::PayTokenContractRef;

/// Errors the vault can revert with.
#[odra::odra_error]
pub enum Error {
    NotAgent = 1,
    ZeroAmount = 2,
    InsufficientShares = 3,
    BadAllocation = 4,
    FeeTooHigh = 5,
}

/// A managed yield vault. Depositors send the pay token in and hold shares. The vault
/// custodies the tokens on chain, deposit pulls them with transfer_from and withdraw
/// sends them back. The fund agent sets a target split across named strategy buckets,
/// and each cycle it accrues yield into the vault from a reserve it controls, which
/// raises the value of every share. The agent only entrypoints are guarded.
///
/// Invariant, total_assets always equals the vault's token balance, deposit and accrue
/// pull tokens in and raise it, withdraw sends tokens out and lowers it.
#[odra::module]
pub struct Vault {
    agent: Var<Address>,
    token: Var<Address>,
    total_shares: Var<U256>,
    total_assets: Var<U256>,
    shares: Mapping<Address, U256>,
    alloc_conservative: Var<u8>,
    alloc_growth: Var<u8>,
    last_decision: Var<String>,
    fee_bps: Var<u32>,
    total_yield: Var<U256>,
}

#[odra::module]
impl Vault {
    pub fn init(&mut self, agent: Address, token: Address) {
        self.agent.set(agent);
        self.token.set(token);
        self.total_shares.set(U256::zero());
        self.total_assets.set(U256::zero());
        self.alloc_conservative.set(100);
        self.alloc_growth.set(0);
        self.fee_bps.set(0);
        self.total_yield.set(U256::zero());
        self.last_decision.set(String::from("init"));
    }

    pub fn agent(&self) -> Address {
        self.agent.get().unwrap()
    }

    pub fn token(&self) -> Address {
        self.token.get().unwrap()
    }

    pub fn total_shares(&self) -> U256 {
        self.total_shares.get_or_default()
    }

    pub fn total_assets(&self) -> U256 {
        self.total_assets.get_or_default()
    }

    pub fn total_yield(&self) -> U256 {
        self.total_yield.get_or_default()
    }

    pub fn shares_of(&self, owner: &Address) -> U256 {
        self.shares.get_or_default(owner)
    }

    pub fn current_allocation(&self) -> (u8, u8) {
        (
            self.alloc_conservative.get_or_default(),
            self.alloc_growth.get_or_default(),
        )
    }

    pub fn last_decision(&self) -> String {
        self.last_decision.get_or_default()
    }

    pub fn fee_bps(&self) -> u32 {
        self.fee_bps.get_or_default()
    }

    fn assert_agent(&self) {
        if self.env().caller() != self.agent.get().unwrap() {
            self.env().revert(Error::NotAgent);
        }
    }

    fn token_ref(&self) -> PayTokenContractRef {
        PayTokenContractRef::new(self.env(), self.token.get().unwrap())
    }

    pub fn set_allocation(&mut self, conservative: u8, growth: u8, decision_ref: String) {
        self.assert_agent();
        if conservative as u32 + growth as u32 != 100 {
            self.env().revert(Error::BadAllocation);
        }
        self.alloc_conservative.set(conservative);
        self.alloc_growth.set(growth);
        self.last_decision.set(decision_ref);
    }

    /// Deposit pay tokens and receive shares. The caller must approve the vault for
    /// the amount first, the vault pulls the tokens in with transfer_from and credits
    /// shares priced against the current assets per share, so a depositor never dilutes
    /// the yield already earned by earlier depositors.
    pub fn deposit(&mut self, amount: U256) {
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
        let me = self.env().self_address();
        self.token_ref().transfer_from(&caller, &me, &amount);

        let total_shares = self.total_shares.get_or_default();
        let total_assets = self.total_assets.get_or_default();
        let minted = if total_shares.is_zero() || total_assets.is_zero() {
            amount
        } else {
            amount * total_shares / total_assets
        };
        self.shares
            .set(&caller, self.shares.get_or_default(&caller) + minted);
        self.total_shares.set(total_shares + minted);
        self.total_assets.set(total_assets + amount);
    }

    /// Burn shares and receive the proportional assets, including the share of yield
    /// accrued while the shares were held. The vault sends the tokens back on chain.
    pub fn withdraw(&mut self, share_amount: U256) {
        let caller = self.env().caller();
        let owned = self.shares.get_or_default(&caller);
        if share_amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        if share_amount > owned {
            self.env().revert(Error::InsufficientShares);
        }
        let total_shares = self.total_shares.get_or_default();
        let total_assets = self.total_assets.get_or_default();
        let assets_out = share_amount * total_assets / total_shares;

        self.shares.set(&caller, owned - share_amount);
        self.total_shares.set(total_shares - share_amount);
        self.total_assets.set(total_assets - assets_out);

        self.token_ref().transfer(&caller, &assets_out);
    }

    /// Accrue yield into the vault. Agent only. The agent holds a reserve of pay token
    /// that stands in for protocol emissions on testnet, approves the vault, and each
    /// cycle moves a real amount in. Shares are unchanged so assets per share rises,
    /// every depositor earns. This is real on chain token movement, the source is the
    /// emissions reserve, not market returns.
    pub fn accrue(&mut self, amount: U256) {
        self.assert_agent();
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
        let me = self.env().self_address();
        self.token_ref().transfer_from(&caller, &me, &amount);
        self.total_assets
            .set(self.total_assets.get_or_default() + amount);
        self.total_yield
            .set(self.total_yield.get_or_default() + amount);
    }

    pub fn set_fee_bps(&mut self, bps: u32) {
        self.assert_agent();
        if bps > 1000 {
            self.env().revert(Error::FeeTooHigh);
        }
        self.fee_bps.set(bps);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::casper_types::U256;
    use odra::host::Deployer;

    use crate::pay_token::{PayToken, PayTokenInitArgs};

    struct Setup {
        env: odra::host::HostEnv,
        token: crate::pay_token::PayTokenHostRef,
        vault: VaultHostRef,
        agent: Address,
        user: Address,
    }

    fn setup() -> Setup {
        let env = odra_test::env();
        let agent = env.get_account(1);
        let user = env.get_account(3);

        env.set_caller(env.get_account(0));
        let mut token = PayToken::deploy(
            &env,
            PayTokenInitArgs { initial_supply: U256::from(1_000_000_000_000u64) },
        );
        token.mint(&agent, &U256::from(1_000_000_000_000u64));
        token.mint(&user, &U256::from(1_000_000_000_000u64));

        let vault = Vault::deploy(
            &env,
            VaultInitArgs { agent, token: token.address().clone() },
        );
        Setup { env, token, vault, agent, user }
    }

    #[test]
    fn deposit_pulls_tokens_and_mints_shares() {
        let mut s = setup();
        let amount = U256::from(10_000_000_000u64); // 10 sUSD

        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &amount);
        s.vault.deposit(amount);

        assert_eq!(s.vault.shares_of(&s.user), amount);
        assert_eq!(s.vault.total_assets(), amount);
        assert_eq!(s.token.balance_of(&s.vault.address().clone()), amount);
    }

    #[test]
    fn accrue_raises_share_value_and_withdraw_returns_principal_plus_yield() {
        let mut s = setup();
        let deposit = U256::from(10_000_000_000u64);

        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &deposit);
        s.vault.deposit(deposit);

        let yield_amt = U256::from(1_000_000_000u64);
        s.env.set_caller(s.agent);
        s.token.approve(&s.vault.address().clone(), &yield_amt);
        s.vault.accrue(yield_amt);

        assert_eq!(s.vault.total_assets(), deposit + yield_amt);
        assert_eq!(s.vault.total_yield(), yield_amt);
        assert_eq!(s.vault.total_shares(), deposit);

        let before = s.token.balance_of(&s.user);
        s.env.set_caller(s.user);
        s.vault.withdraw(deposit);
        let got = s.token.balance_of(&s.user) - before;
        assert_eq!(got, deposit + yield_amt);
        assert_eq!(s.vault.total_assets(), U256::zero());
    }

    #[test]
    fn non_agent_cannot_accrue() {
        let mut s = setup();
        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &U256::from(1u64));
        let err = s.vault.try_accrue(U256::from(1u64)).unwrap_err();
        assert_eq!(err, Error::NotAgent.into());
    }

    #[test]
    fn agent_sets_allocation_and_non_agent_cannot() {
        let mut s = setup();
        s.env.set_caller(s.agent);
        s.vault.set_allocation(60, 40, String::from("ref-1"));
        assert_eq!(s.vault.current_allocation(), (60, 40));

        s.env.set_caller(s.user);
        let err = s
            .vault
            .try_set_allocation(60, 40, String::from("x"))
            .unwrap_err();
        assert_eq!(err, Error::NotAgent.into());
    }

    #[test]
    fn allocation_must_sum_to_100() {
        let mut s = setup();
        s.env.set_caller(s.agent);
        let err = s
            .vault
            .try_set_allocation(60, 30, String::from("x"))
            .unwrap_err();
        assert_eq!(err, Error::BadAllocation.into());
    }
}
