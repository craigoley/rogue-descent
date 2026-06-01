# Security Policy

## About this project

Rogue Descent is a static, client-side browser game (TypeScript + Three.js,
built with Vite) deployed as static assets on Vercel. It has no backend,
no server-side code, no authentication, no database, and collects no
personal data. Game state is stored locally in the visitor's own browser
(localStorage) and is never transmitted.

The realistic security surface is therefore limited to third-party
dependency vulnerabilities, which are monitored via OSV-Scanner, CodeQL,
and Dependabot in this repository.

## Supported versions

This project is continuously deployed from `main`. Only the currently
deployed version receives fixes; there are no maintained release branches.

| Version            | Supported |
| ------------------ | --------- |
| Deployed `main`    | Yes       |
| Anything older     | No        |

## Reporting a vulnerability

Please do not open a public issue for security reports.

Use GitHub's private vulnerability reporting for this repository:
**Security → Report a vulnerability** (the "Report a vulnerability" button
on the repo's Security tab). This opens a private advisory visible only to
the maintainers.

We'll acknowledge a valid report as soon as we're able. As a personal
hobby project, response times are best-effort, not guaranteed.
