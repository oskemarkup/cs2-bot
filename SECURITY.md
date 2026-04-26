# Security Policy

## Operating Boundary

This project is read-only for data collection and analytics. Execution remains manual. The codebase must not include Steam UI automation, Steam Guard automation, marketplace UI automation, proxy rotation, captcha handling, rate-limit bypassing, or automatic purchase/sale execution.

## Secrets

- Store API keys only in environment variables.
- Never commit `.env` files or real credentials.
- Add new required configuration through `packages/config` and `.env.example`.

## Marketplace Access

- Validate every marketplace API response with Zod before using it.
- Give every connector its own Bottleneck rate limiter.
- Respect published API limits and terms.
- Prefer official API surfaces over scraping.

## Money

- Store monetary values as integer minor units in TypeScript.
- Store monetary values as PostgreSQL integer minor units or `numeric`.
- Do not represent money as JavaScript floating-point numbers.

## Reporting

For security issues, open a private report with reproduction steps, affected package/app, and expected impact.
