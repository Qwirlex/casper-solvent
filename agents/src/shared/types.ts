export interface Feed {
  asset: string;
  price: number;
  changePct24h: number;
  ts: number;
}

export interface RiskScore {
  score: number;      // 0 low risk to 100 high risk
  rationale: string;
}

export interface Allocation {
  conservative: number; // 0..100
  growth: number;       // 0..100
}

export interface Decision {
  allocation: Allocation;
  decisionRef: string;
  reason: string;
}
