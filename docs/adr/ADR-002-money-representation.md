# ADR-002: Money Representation

## Status

Accepted

## Context

CS2 marketplace prices are financial values. JavaScript floating-point numbers can introduce rounding errors that are unacceptable for analytics, alerts, and paper trading calculations.

## Decision

TypeScript code represents money as integer minor units using `bigint`. PostgreSQL stores money as integer minor units or `numeric` when precision requirements demand it. Currency is stored explicitly as a three-letter code.

## Consequences

- API schemas must parse prices into integer minor units before persistence.
- Database columns for prices use `bigint` with Drizzle `mode: "bigint"` unless a `numeric` column is explicitly justified.
- Formatting money for display is separate from storage and computation.
