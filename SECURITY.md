# Security

DailyWork stores API tokens, OAuth client secrets and session cookies in the
Electron safeStorage vault under the user-data directory. Those files must not
be committed.

Report vulnerabilities privately via GitHub Security Advisories on this
repository. Do not open a public issue with tokens, cookies, form dumps or
screenshots of authenticated sessions.

When running candidacy or campaign automations, keep CAPTCHA, payments,
biometrics and government-ID fields out of logs.
