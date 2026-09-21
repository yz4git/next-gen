# Repository metadata automation

WorldSeed keeps its GitHub **Description**, **Website**, and **Topics** in:

`.github/repository-metadata.json`

When that file changes on `main`, the **Sync repository metadata** workflow applies those three fields through the GitHub REST API.

## One-time setup

Create a **fine-grained personal access token** restricted to the `yz4git/next-gen` repository.

Required repository permission:

- **Administration: Read and write**

Then add the token to this repository as an Actions secret named:

`REPO_ADMIN_TOKEN`

Do not put the token in a file, issue, pull request, chat message, commit, or workflow input.

After the secret exists, change `syncVersion` in `.github/repository-metadata.json` and merge that change to `main`. The workflow will apply the configured metadata.

## Scope

The workflow intentionally updates only:

- repository description;
- repository homepage / Website;
- repository topics.

It does not change visibility, branch protection, collaborators, Actions settings, repository name, or other administration settings.

## Security

The fine-grained token should:

- have access to **only** `yz4git/next-gen`;
- use the shortest practical expiration;
- grant only the repository permission needed here;
- be stored only as the `REPO_ADMIN_TOKEN` Actions secret.

Delete or rotate the token at any time to revoke this automation.
