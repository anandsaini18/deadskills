# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| 0.1.x   | Best effort |
| < 0.1   | No        |

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Email **anandsaini18@gmail.com** with:

- A clear description of the issue
- Steps to reproduce
- Affected version
- Impact assessment

## Response timeline

- **48 hours:** acknowledgment
- **7 days:** preliminary assessment
- **30 days:** target for a fix or mitigation

## Scope

`deadskills` reads local transcript and skill files and prints a report. It does not execute shell commands, call network APIs at runtime, or upload data. Reports intentionally omit local paths so output is safe to paste in issues.

If you find a way to trick the parser into reading unexpected files or exfiltrating data through the report, we want to know.

## Safe harbor

Good faith security research is welcome. We will not pursue action against researchers who avoid privacy violations and service disruption, report promptly, and do not disclose publicly before a fix is available.
