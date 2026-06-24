use odra::casper_types::U256;
use odra::prelude::*;
use odra_modules::cep18_token::Cep18;

/// A minimal CEP-18 test token used for two roles in Solvent, the asset deposited
/// into the vault and the currency the fund agent pays with over x402.
#[odra::module]
pub struct PayToken {
    token: SubModule<Cep18>,
}

#[odra::module]
impl PayToken {
    pub fn init(&mut self, initial_supply: U256) {
        self.token.init(
            String::from("sUSD"),
            String::from("Solvent Test USD"),
            9u8,
            initial_supply,
        );
    }

    pub fn balance_of(&self, address: &Address) -> U256 {
        self.token.balance_of(address)
    }

    pub fn transfer(&mut self, recipient: &Address, amount: &U256) {
        self.token.transfer(recipient, amount)
    }

    pub fn mint(&mut self, owner: &Address, amount: &U256) {
        self.token.raw_mint(owner, amount)
    }

    pub fn total_supply(&self) -> U256 {
        self.token.total_supply()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::casper_types::U256;
    use odra::host::Deployer;
    use odra::prelude::*;

    #[test]
    fn mints_initial_supply_to_deployer() {
        let env = odra_test::env();
        let deployer = env.get_account(0);
        env.set_caller(deployer);
        let token = PayToken::deploy(
            &env,
            PayTokenInitArgs { initial_supply: U256::from(1_000_000u64) },
        );
        assert_eq!(token.balance_of(&deployer), U256::from(1_000_000u64));
    }
}
