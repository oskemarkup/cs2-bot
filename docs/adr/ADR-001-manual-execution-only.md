# ADR-001: Manual Execution Only

## Status

Accepted

## Context

The first stage of the bot is limited to read-only data collection, alerts, paper trading, and manual review checklists. Marketplace and Steam actions involve account, financial, and compliance risk.

## Decision

The system will not automate Steam UI, Steam Guard, marketplace UI, purchase execution, sale execution, proxy rotation, captcha handling, or rate-limit bypassing. Alerts may describe a candidate opportunity, but a human must review and execute any real-world action outside this system.

## Consequences

- Connectors expose read-only data contracts.
- Workers may enqueue and process collection jobs only.
- Risk checks reject execution-style actions.
- Documentation and tests must preserve this boundary at the end of every sprint.
