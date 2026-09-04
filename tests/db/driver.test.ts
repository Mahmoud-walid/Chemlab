import { describe, expect, it } from "vitest";

import { driverFor, requiresSsl } from "@/db/driver";

describe("driverFor", () => {
  it("routes Neon hosts to the serverless driver", () => {
    expect(
      driverFor(
        "postgresql://u:p@ep-holy-sunset-pooler.c-5.us-east-2.aws.neon.tech/db?sslmode=require",
      ),
    ).toBe("neon");
    expect(
      driverFor("postgresql://u:p@ep-direct.eu-central-1.aws.neon.tech/db"),
    ).toBe("neon");
  });

  it("routes a local cluster to node-postgres", () => {
    expect(
      driverFor("postgresql://chemlab:chemlab@127.0.0.1:5432/chemlab"),
    ).toBe("node-postgres");
    expect(driverFor("postgres://chemlab@localhost/chemlab")).toBe(
      "node-postgres",
    );
  });

  it("routes other managed hosts to node-postgres", () => {
    expect(
      driverFor("postgresql://u:p@db.example.rds.amazonaws.com:5432/app"),
    ).toBe("node-postgres");
  });

  it("matches on the host suffix, not a substring anywhere in the URL", () => {
    // A lookalike host, and the literal string in a password and a database
    // name, must not be mistaken for Neon.
    expect(driverFor("postgresql://u:p@neon.tech.attacker.example/db")).toBe(
      "node-postgres",
    );
    expect(driverFor("postgresql://u:.neon.tech@127.0.0.1:5432/db")).toBe(
      "node-postgres",
    );
    expect(driverFor("postgresql://u:p@127.0.0.1:5432/.neon.tech")).toBe(
      "node-postgres",
    );
  });

  it("falls back to node-postgres for an unparseable URL", () => {
    // The env schema owns rejecting these; this only has to not throw.
    expect(driverFor("not a url")).toBe("node-postgres");
    expect(driverFor("")).toBe("node-postgres");
  });
});

describe("requiresSsl", () => {
  it("requires TLS for Neon and not for a local cluster", () => {
    expect(requiresSsl("postgresql://u:p@ep-x-pooler.aws.neon.tech/db")).toBe(
      true,
    );
    expect(
      requiresSsl("postgresql://chemlab:chemlab@127.0.0.1:5432/chemlab"),
    ).toBe(false);
  });
});
