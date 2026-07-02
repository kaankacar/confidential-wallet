/**
 * Reused confidential-token deployment on Stellar testnet (from oz-demo's
 * deployments/testnet.json). The contracts include an auditor at the protocol
 * level — this wallet simply never surfaces it (no auditor page, no disclosure).
 * Amounts are hidden from the public chain regardless.
 */
export const DEPLOYMENT = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  deployedAtLedger: 3171184,
  /** All confidential accounts register under auditor id 0 (unused by the UI). */
  auditorId: 0,
  contracts: {
    token: "CCJM3DHVL6G3H36GTB37RADYDGGWRPRIP45AGDV3DL5QD4IKKAVYIFEA",
    verifier: "CDEZ5STEQCZEUXIH4AMLRRAZRY6H4V4N47MHAZYKH5AZCARR3KYAQKB3",
    auditor: "CAOJVT7YZRM5AQWEZVGWRI7PNGDMRJ2WYHGJZ4CWQS4G6Z3N2PABM6VO",
    /** Native XLM SAC — the public asset that backs the confidential balance. */
    underlying: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
} as const;

export const EXPLORER = "https://stellar.expert/explorer/testnet";
