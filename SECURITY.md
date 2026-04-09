# Security Policy

## Secrets Handling

- Never commit credentials, API keys, private keys, or `.env` files.
- Keep runtime secrets in environment variables, AWS Secrets Manager, or equivalent secret storage.
- Use `.env.example` files for placeholders only.

## If A Secret Is Exposed

1. Revoke or rotate the exposed credential immediately.
2. Remove the secret from tracked files and commit history.
3. Audit infrastructure and logs for unexpected usage.
4. Replace root or shared credentials with least-privilege IAM users/roles.
5. Re-deploy services with updated credentials.

## Repository Controls

- Automated secret scanning runs in GitHub Actions on pushes and pull requests.
- Local `.env*` files are ignored by git at repo and frontend levels.

## AWS Recommendations

- Do not use root access keys for CLI or applications.
- Use IAM roles for EC2 workloads and IAM users for human/automation CLI access.
- Enable and enforce MFA for privileged users.
