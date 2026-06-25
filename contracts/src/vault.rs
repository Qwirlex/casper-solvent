use odra::casper_types::U256;
use odra::prelude::*;
use odra::ContractRef;

use crate::pay_token::PayTokenContractRef;

/// Errors the vault can revert with.
#[odra::odra_error]
pub enum Error {
    NotAgent = 1,
    ZeroAmount = 2,
    InsufficientBalance = 3,
    BadAllocation = 4,
}

/// A managed yield vault with per account accounting. Each depositor has a principal,
/// the amount they put in, and an earned balance, the yield credited to them. The
/// vault custodies the pay token on chain, deposit pulls it with transfer_from and
/// withdraw sends it back. The fund agent accrues yield per account, the amount is set
/// by the agent so larger depositors can earn a higher rate. Agent only entrypoints are
/// guarded, and the agent can never move a depositor's funds to itself, it can only add.
///
/// Invariant, total_assets equals the vault token balance and equals total_principal
/// plus total_yield.
#[odra::module]
pub struct Vault {
    agent: Var<Address>,
    token: Var<Address>,
    total_assets: Var<U256>,
    total_principal: Var<U256>,
    total_yield: Var<U256>,
    deposited: Mapping<Address, U256>,
    earned: Mapping<Address, U256>,
    alloc_conservative: Var<u8>,
    alloc_growth: Var<u8>,
    last_decision: Var<String>,
}

#[odra::module]
impl Vault {
    pub fn init(&mut self, agent: Address, token: Address) {
        self.agent.set(agent);
        self.token.set(token);
        self.total_assets.set(U256::zero());
        self.total_principal.set(U256::zero());
        self.total_yield.set(U256::zero());
        self.alloc_conservative.set(100);
        self.alloc_growth.set(0);
        self.last_decision.set(String::from("init"));
    }

    pub fn agent(&self) -> Address {
        self.agent.get().unwrap()
    }

    pub fn token(&self) -> Address {
        self.token.get().unwrap()
    }

    pub fn total_assets(&self) -> U256 {
        self.total_assets.get_or_default()
    }

    pub fn total_principal(&self) -> U256 {
        self.total_principal.get_or_default()
    }

    pub fn total_yield(&self) -> U256 {
        self.total_yield.get_or_default()
    }

    pub fn deposited_of(&self, owner: &Address) -> U256 {
        self.deposited.get_or_default(owner)
    }

    pub fn earned_of(&self, owner: &Address) -> U256 {
        self.earned.get_or_default(owner)
    }

    pub fn balance_of(&self, owner: &Address) -> U256 {
        self.deposited.get_or_default(owner) + self.earned.get_or_default(owner)
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

    /// Deposit pay tokens. The caller approves the vault first, the vault pulls the
    /// tokens in and credits the caller's principal.
    pub fn deposit(&mut self, amount: U256) {
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
        let me = self.env().self_address();
        self.token_ref().transfer_from(&caller, &me, &amount);
        self.deposited.set(&caller, self.deposited.get_or_default(&caller) + amount);
        self.total_principal.set(self.total_principal.get_or_default() + amount);
        self.total_assets.set(self.total_assets.get_or_default() + amount);
    }

    /// Accrue yield to one account. Agent only. The agent holds a reserve and a standing
    /// allowance to the vault, the amount per account is chosen by the agent so a larger
    /// principal can earn a higher rate. Real tokens move in, the account's earned grows.
    pub fn accrue(&mut self, owner: Address, amount: U256) {
        self.assert_agent();
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
        let me = self.env().self_address();
        self.token_ref().transfer_from(&caller, &me, &amount);
        self.earned.set(&owner, self.earned.get_or_default(&owner) + amount);
        self.total_yield.set(self.total_yield.get_or_default() + amount);
        self.total_assets.set(self.total_assets.get_or_default() + amount);
    }

    /// Withdraw up to the caller's balance, principal plus earned. Earned is drawn down
    /// first. The vault sends the tokens back on chain.
    pub fn withdraw(&mut self, amount: U256) {
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
        let deposited = self.deposited.get_or_default(&caller);
        let earned = self.earned.get_or_default(&caller);
        if amount > deposited + earned {
            self.env().revert(Error::InsufficientBalance);
        }
        let from_earned = if amount <= earned { amount } else { earned };
        let from_principal = amount - from_earned;
        self.earned.set(&caller, earned - from_earned);
        self.deposited.set(&caller, deposited - from_principal);
        self.total_yield.set(self.total_yield.get_or_default() - from_earned);
        self.total_principal.set(self.total_principal.get_or_default() - from_principal);
        self.total_assets.set(self.total_assets.get_or_default() - amount);
        self.token_ref().transfer(&caller, &amount);
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
        let vault = Vault::deploy(&env, VaultInitArgs { agent, token: token.address().clone() });
        Setup { env, token, vault, agent, user }
    }

    #[test]
    fn deposit_credits_principal_and_custodies() {
        let mut s = setup();
        let amount = U256::from(10_000_000_000u64);
        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &amount);
        s.vault.deposit(amount);
        assert_eq!(s.vault.deposited_of(&s.user), amount);
        assert_eq!(s.vault.balance_of(&s.user), amount);
        assert_eq!(s.token.balance_of(&s.vault.address().clone()), amount);
    }

    #[test]
    fn accrue_credits_earned_per_account_and_withdraw_returns_all() {
        let mut s = setup();
        let deposit = U256::from(10_000_000_000u64);
        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &deposit);
        s.vault.deposit(deposit);

        let yield_amt = U256::from(2_000_000_000u64);
        s.env.set_caller(s.agent);
        s.token.approve(&s.vault.address().clone(), &yield_amt);
        s.vault.accrue(s.user, yield_amt);

        assert_eq!(s.vault.earned_of(&s.user), yield_amt);
        assert_eq!(s.vault.balance_of(&s.user), deposit + yield_amt);
        assert_eq!(s.vault.total_yield(), yield_amt);

        let before = s.token.balance_of(&s.user);
        s.env.set_caller(s.user);
        s.vault.withdraw(deposit + yield_amt);
        assert_eq!(s.token.balance_of(&s.user) - before, deposit + yield_amt);
        assert_eq!(s.vault.balance_of(&s.user), U256::zero());
        assert_eq!(s.vault.total_assets(), U256::zero());
    }

    #[test]
    fn non_agent_cannot_accrue() {
        let mut s = setup();
        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &U256::from(1u64));
        let err = s.vault.try_accrue(s.user, U256::from(1u64)).unwrap_err();
        assert_eq!(err, Error::NotAgent.into());
    }

    #[test]
    fn cannot_withdraw_more_than_balance() {
        let mut s = setup();
        let deposit = U256::from(5_000_000_000u64);
        s.env.set_caller(s.user);
        s.token.approve(&s.vault.address().clone(), &deposit);
        s.vault.deposit(deposit);
        let err = s.vault.try_withdraw(deposit + U256::from(1u64)).unwrap_err();
        assert_eq!(err, Error::InsufficientBalance.into());
    }

    #[test]
    fn agent_sets_allocation() {
        let mut s = setup();
        s.env.set_caller(s.agent);
        s.vault.set_allocation(40, 60, String::from("ref"));
        assert_eq!(s.vault.current_allocation(), (40, 60));
    }
}
