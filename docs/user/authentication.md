# Authentication

API Hero applies authentication after variable resolution. **Authentication**
entries store **metadata** in settings; secret fields use VS Code **Secret Storage**.

## Providers

| Provider | Behavior |
| --- | --- |
| `none` | No decoration |
| `basic` | `Authorization: Basic …` |
| `bearer` | `Authorization: Bearer …` |
| `apiKey` | Custom header or query parameter |

OAuth2 account Login/Logout, cookie jars, and automatic token-refresh flows are **not**
implemented. **Authentication Login API** (session login against your API) is supported —
see [Login API](#login-api) below. That is separate from the palette-hidden
**Account Login (Not Available)** stub.

## Manage Authentication

1. **API Hero: Manage Authentication** opens the Auth Manager webview.
2. Create Authentication from templates (Bearer, API Key, Basic, JWT Login, …) or edit
   an existing entry (provider, label, credential sources).
3. Secrets may be entered **inline** in Auth Manager (posted once to Secret Storage,
   then masked) or via Secret Storage prompts — never written into `.api` files
   as cleartext.
4. Use **Test** and **Run Login** from Auth Manager for health and session lifecycle.

Credential sources:

- `secret` — Secret Storage
- `variable` — resolved variable name
- `literal` — explicit value with `unsafe: true` (discouraged)

## Select Authentication for a request

| Approach | How |
| --- | --- |
| In file | `@auth <id>` on the request (or document level) |
| Session default | **API Hero: Select Authentication** (or Request Editor **Session default…**) |
| Collection default | **API Hero: Set Collection Default Authentication** (marker; also from Collections tree) |
| Request Editor | Modes: None, One-shot Bearer, or Saved Authentication |
| One-shot | Paste a Bearer token in the Request Editor for a single Send (not saved to `.api`) |

Precedence: request `@auth` → document `@auth` → **collection default** → session default → `none`.
One-shot overrides that list for a single Send only.

The Request Editor toolbar **Authentication** chip opens **Select Authentication**
(session default). Request-local auth is configured on the **Auth** tab.

## One-shot and Save as Authentication

1. Auth tab → **One-shot** → paste Bearer token → **Send**.
2. On success, a banner offers **Reuse this Authentication?** → **Save** / **Dismiss**.
3. Save creates a secret-backed Authentication; Dismiss clears the temporary token.

## Login API

Configure a login endpoint on an Authentication (Auth Manager → **Run Login** wizard,
or **API Hero: Run Authentication Login**):

1. Method, URL, and body template
2. Credentials → Secret Storage
3. Run login through the Request Engine
4. Choose detected token fields (`access_token`, `refresh_token`, …)
5. Confirm before overwriting an existing Session

Session access/refresh tokens stay in Secret Storage. Metadata (expiry, health) is
non-secret.

## Test Authentication

**API Hero: Test Authentication** (or Auth Manager **Test**) probes a URL with the
resolved Authentication / Session and updates **Health** (Healthy, Expired, Unauthorized,
Never tested, Needs Login, …). Results may show **Identity** when detectable.

## Response → Use as Authentication

When a JSON response contains likely tokens, the Response viewer offers
**Detected Authentication** → Create Session / Use as Authentication. Always confirm;
existing Sessions are not overwritten silently.

## Health, Identity, Preview

| Concept | Meaning |
| --- | --- |
| Health | Derived status (never a permanent “Connected” badge) |
| Identity | Presentation-only subject from Test/Login when detectable |
| Preview | Masked headers/query that will be sent; copy header **names** only |

## Related

- [Environments](./environments.md)
- [Creating requests](./creating-requests.md)
- [Configuration](../reference/configuration.md) (`apiHero.authentication.profiles`)
