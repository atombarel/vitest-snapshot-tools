import { describe, expect, it } from "vitest";

describe("demo API request review", () => {
  it("lists active customers", () => {
    const requestLog = {
      level: "info",
      requestId: "req_customers_7f31",
      method: "GET",
      path: "/v1/customers?status=active&limit=20",
      actor: "dashboard:andrea",
      durationMs: 47,
      message: "Customer list returned",
    };
    const httpResponse = {
      status: 200,
      headers: { "content-type": "application/json", "x-page-size": "20" },
      body: {
        data: [
          { id: "cus_001", name: "Ada Lovelace", plan: "enterprise" },
          { id: "cus_002", name: "Grace Hopper", plan: "pro" },
        ],
        nextCursor: "cus_003",
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });

  it("creates an invoice", () => {
    const requestLog = {
      level: "info",
      requestId: "req_invoice_b931",
      method: "POST",
      path: "/v1/invoices",
      actor: "service:billing-worker",
      durationMs: 126,
      message: "Invoice created and queued for delivery",
    };
    const httpResponse = {
      status: 201,
      headers: {
        "content-type": "application/json",
        location: "/v1/invoices/inv_804",
      },
      body: {
        id: "inv_804",
        customerId: "cus_001",
        currency: "USD",
        total: 12900,
        state: "open",
        lineItems: [
          { description: "Pro plan", quantity: 1, unitAmount: 9900 },
          { description: "Extra seats", quantity: 3, unitAmount: 1000 },
        ],
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });

  it("upgrades a subscription", () => {
    const requestLog = {
      level: "info",
      requestId: "req_subscription_51ca",
      method: "PATCH",
      path: "/v1/subscriptions/sub_42",
      actor: "user:usr_admin_9",
      durationMs: 83,
      message: "Subscription plan changed",
    };
    const httpResponse = {
      status: 200,
      headers: { "content-type": "application/json", etag: '"sub_42:v8"' },
      body: {
        id: "sub_42",
        previousPlan: "pro",
        plan: "enterprise",
        seats: 25,
        effectiveAt: "2026-07-13T14:32:00.000Z",
        features: ["audit-log", "sso", "priority-support"],
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });

  it("returns an audit-log page", () => {
    const requestLog = {
      level: "info",
      requestId: "req_audit_30fe",
      method: "GET",
      path: "/v1/audit-log?after=evt_1200",
      actor: "user:security_2",
      durationMs: 64,
      message: "Audit events returned",
    };
    const httpResponse = {
      status: 200,
      headers: { "content-type": "application/json", "x-result-count": "2" },
      body: {
        data: [
          { id: "evt_1201", action: "member.invited", actor: "usr_admin_9" },
          { id: "evt_1202", action: "role.changed", actor: "usr_admin_9" },
        ],
        nextCursor: "evt_1202",
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });

  it("rotates an API key", () => {
    const requestLog = {
      level: "warn",
      requestId: "req_key_90dd",
      method: "POST",
      path: "/v1/api-keys/key_7/rotate",
      actor: "user:security_2",
      durationMs: 211,
      message: "API key rotated; previous credential revoked",
    };
    const httpResponse = {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: {
        id: "key_7",
        prefix: "vsnap_live_9d2f",
        scopes: ["snapshots:read", "snapshots:write"],
        expiresAt: "2027-07-13T00:00:00.000Z",
        secret: "shown-once-in-demo",
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });

  it("rejects an invalid webhook", () => {
    const requestLog = {
      level: "error",
      requestId: "req_webhook_c4aa",
      method: "POST",
      path: "/v1/webhooks/events",
      actor: "integration:payments",
      durationMs: 18,
      message: "Webhook signature validation failed",
    };
    const httpResponse = {
      status: 401,
      headers: {
        "content-type": "application/problem+json",
        "retry-after": "0",
      },
      body: {
        type: "https://api.example.test/problems/invalid-signature",
        title: "Invalid webhook signature",
        detail: "The signature did not match the request payload",
        requestId: "req_webhook_c4aa",
      },
    };

    expect(requestLog).toMatchSnapshot("request log");
    expect(httpResponse).toMatchSnapshot("HTTP response");
  });
});
