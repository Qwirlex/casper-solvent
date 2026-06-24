use odra::casper_types::U256;
use odra::prelude::*;

/// Errors the vault can revert with.
#[odra::odra_error]
pub enum Error {
    NotAgent = 1,
    ZeroAmount = 2,
    InsufficientShares = 3,
    BadAllocation = 4,
    FeeTooHigh = 5,
}

/// A managed vault. Depositors hold shares. The fund agent sets a target split
/// across named strategy buckets and skims a capped performance fee. The agent
/// account is the only one allowed to set allocation, rebalance, and harvest.
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
        self.last_decision.set(String::from("init"));
    }

    pub fn agent(&self) -> Address {
        self.agent.get().unwrap()
    }

    pub fn total_shares(&self) -> U256 {
        self.total_shares.get_or_default()
    }

    pub fn total_assets(&self) -> U256 {
        self.total_assets.get_or_default()
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

    pub fn set_allocation(&mut self, conservative: u8, growth: u8, decision_ref: String) {
        self.assert_agent();
        if conservative as u32 + growth as u32 != 100 {
            self.env().revert(Error::BadAllocation);
        }
        self.alloc_conservative.set(conservative);
        self.alloc_growth.set(growth);
        self.last_decision.set(decision_ref);
    }

    pub fn deposit(&mut self, amount: U256) {
        if amount.is_zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let caller = self.env().caller();
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
    }

    pub fn set_fee_bps(&mut self, bps: u32) {
        self.assert_agent();
        if bps > 1000 {
            self.env().revert(Error::FeeTooHigh);
        }
        self.fee_bps.set(bps);
    }

    pub fn harvest_fee(&mut self) -> U256 {
        self.assert_agent();
        let total_assets = self.total_assets.get_or_default();
        let fee = total_assets * U256::from(self.fee_bps.get_or_default()) / U256::from(10000u64);
        self.total_assets.set(total_assets - fee);
        fee
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::casper_types::U256;
    use odra::host::Deployer;
    use odra::prelude::*;

    fn deploy(env: &odra::host::HostEnv) -> VaultHostRef {
        let agent = env.get_account(1);
        let token = env.get_account(9);
        Vault::deploy(env, VaultInitArgs { agent, token })
    }

    #[test]
    fn init_sets_agent_and_default_allocation() {
        let env = odra_test::env();
        let vault = deploy(&env);
        assert_eq!(vault.agent(), env.get_account(1));
        assert_eq!(vault.current_allocation(), (100, 0));
        assert_eq!(vault.total_shares(), U256::zero());
    }

    #[test]
    fn agent_sets_allocation() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        env.set_caller(env.get_account(1));
        vault.set_allocation(60, 40, String::from("ref-1"));
        assert_eq!(vault.current_allocation(), (60, 40));
        assert_eq!(vault.last_decision(), String::from("ref-1"));
    }

    #[test]
    fn non_agent_cannot_set_allocation() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        env.set_caller(env.get_account(2));
        let err = vault
            .try_set_allocation(60, 40, String::from("x"))
            .unwrap_err();
        assert_eq!(err, Error::NotAgent.into());
    }

    #[test]
    fn allocation_must_sum_to_100() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        env.set_caller(env.get_account(1));
        let err = vault
            .try_set_allocation(60, 30, String::from("x"))
            .unwrap_err();
        assert_eq!(err, Error::BadAllocation.into());
    }

    #[test]
    fn first_deposit_mints_one_to_one() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        let user = env.get_account(3);
        env.set_caller(user);
        vault.deposit(U256::from(1000u64));
        assert_eq!(vault.shares_of(&user), U256::from(1000u64));
        assert_eq!(vault.total_assets(), U256::from(1000u64));
    }

    #[test]
    fn withdraw_returns_proportional_assets() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        let user = env.get_account(3);
        env.set_caller(user);
        vault.deposit(U256::from(1000u64));
        vault.withdraw(U256::from(400u64));
        assert_eq!(vault.shares_of(&user), U256::from(600u64));
        assert_eq!(vault.total_assets(), U256::from(600u64));
    }

    #[test]
    fn cannot_withdraw_more_than_owned() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        let user = env.get_account(3);
        env.set_caller(user);
        vault.deposit(U256::from(100u64));
        let err = vault.try_withdraw(U256::from(101u64)).unwrap_err();
        assert_eq!(err, Error::InsufficientShares.into());
    }

    #[test]
    fn fee_cap_enforced() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        env.set_caller(env.get_account(1));
        let err = vault.try_set_fee_bps(1001).unwrap_err();
        assert_eq!(err, Error::FeeTooHigh.into());
    }

    #[test]
    fn harvest_takes_fee_from_assets() {
        let env = odra_test::env();
        let mut vault = deploy(&env);
        let user = env.get_account(3);
        env.set_caller(user);
        vault.deposit(U256::from(10000u64));
        env.set_caller(env.get_account(1));
        vault.set_fee_bps(500);
        let fee = vault.harvest_fee();
        assert_eq!(fee, U256::from(500u64));
        assert_eq!(vault.total_assets(), U256::from(9500u64));
    }
}
