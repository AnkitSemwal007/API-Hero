# Assertions

Assertions are `expect` lines associated with a request. They run **after** HTTP execution against the result — they never send requests themselves.

## Write expectations

Place `expect` lines with the request (typically after headers/body). Example:

```api
@name Health
GET {{baseUrl}}/health

expect status == 200
expect header Content-Type contains "json"
expect body.status == "ok"
expect responseTime < 500
```

## Subjects and operators

Common subjects: `status`, `header <Name>`, `body.<path>`, `content-type`, `responseTime`, `responseSize`.

Common operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in […]`, `contains`, `exists`, `isEmpty`, `isNull`.

Commented `# expect …` lines are ignored.

## Run assertions

| Path | Behavior |
| --- | --- |
| **Run Request with Assertions** | Evaluate and show in Response viewer / Problems |
| Collection **Run Collection Tests** | Run collection with assertion focus |
| Collection run | Assertion counts appear in the Run Report |

Failures open in the Problems panel (post-run only).

## Related

- [Creating requests](./creating-requests.md)
- [Collection runner](./collection-runner.md)
- [Response viewer](./response-viewer.md)
