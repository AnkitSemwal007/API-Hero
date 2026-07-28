# Authentication

API Hero applies authentication after variable resolution. Profiles store **metadata** in settings; secret fields use VS Code **Secret Storage**.

## Providers

| Provider | Behavior |
| --- | --- |
| `none` | No decoration |
| `basic` | `Authorization: Basic …` |
| `bearer` | `Authorization: Bearer …` |
| `apiKey` | Custom header or query parameter |

OAuth2, cookie jars, and token-refresh flows are **not** implemented.

## Manage profiles

1. **API Hero: Manage Authentication** opens the Auth Manager webview.
2. Create or edit profiles (provider, label, credential sources).
3. Secret sources are entered through Secret Storage prompts — never written into `.api` files or the webview as cleartext.

Credential sources:

- `secret` — Secret Storage
- `variable` — resolved variable name
- `literal` — explicit value with `unsafe: true` (discouraged)

## Select auth for a request

| Approach | How |
| --- | --- |
| In file | `@auth profileId` on the request (or document level) |
| Session default | **API Hero: Select Authentication Profile** |
| Request Editor | Auth picker / manage profiles actions |

Precedence: request `@auth` → document `@auth` → session default → `none`.

## Related

- [Environments](./environments.md)
- [Creating requests](./creating-requests.md)
- [Configuration](../reference/configuration.md) (`apiHero.authentication.profiles`)
