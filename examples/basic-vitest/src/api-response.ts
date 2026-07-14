const customers = [
  ["cus_001", "Ada Lovelace", "eu-west"],
  ["cus_002", "Grace Hopper", "us-east"],
  ["cus_003", "Katherine Johnson", "us-east"],
  ["cus_004", "Margaret Hamilton", "us-west"],
  ["cus_005", "Evelyn Boyd Granville", "us-central"],
  ["cus_006", "Mary Jackson", "us-east"],
  ["cus_007", "Dorothy Vaughan", "us-east"],
  ["cus_008", "Annie Easley", "us-central"],
  ["cus_009", "Radia Perlman", "us-west"],
  ["cus_010", "Barbara Liskov", "us-east"],
  ["cus_011", "Frances Allen", "us-east"],
  ["cus_012", "Karen Spärck Jones", "eu-west"],
  ["cus_013", "Joan Clarke", "eu-west"],
  ["cus_014", "Mary Cartwright", "eu-west"],
] as const;

export function buildApiResponse() {
  return {
    requestId: "req_20260713_9fd8a2",
    generatedAt: "2026-07-13T14:32:00.000Z",
    pagination: {
      page: 1,
      perPage: 20,
      total: customers.length,
      nextCursor: null,
    },
    summary: {
      active: 11,
      trial: 2,
      suspended: 1,
      monthlyRecurringRevenue: 2_874,
    },
    data: customers.map(([id, name, region], index) => {
      const status =
        index === 8 ? "suspended" : index > 10 ? "trial" : "active";
      const plan =
        index % 4 === 0 ? "enterprise" : index % 3 === 0 ? "team" : "pro";
      return {
        id,
        name,
        email: `${name.toLowerCase().replaceAll(" ", ".")}@example.test`,
        status,
        region,
        subscription: {
          plan,
          interval: "monthly",
          renewalAt: `2026-08-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
          amount: plan === "enterprise" ? 399 : plan === "team" ? 199 : 99,
        },
        usage: {
          apiCalls: 12_450 + index * 2_731,
          storageMb: 768 + index * 317,
          seats: plan === "enterprise" ? 25 : plan === "team" ? 12 : 5,
        },
        features: {
          auditLog: plan !== "pro",
          singleSignOn: plan === "enterprise",
          snapshotReview: true,
        },
        tags: index % 2 === 0 ? ["beta", "api"] : ["api"],
      };
    }),
  };
}
