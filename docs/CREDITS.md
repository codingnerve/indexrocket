# Credits and admin accounts

## Model

- Every user has a stored `credits` balance (non-negative integer, default `0`)
  and a `role` (`user` or `admin`).
- **Admins have unlimited credits.** This is derived from the stored role, not
  from the balance: an admin's `credits` value is never changed, and it is never
  set to `Infinity`.
- The API computes `unlimitedCredits` in the user view (`/api/auth/me`, login,
  register). The web app only displays it.

All policy lives in `apps/api/src/services/billing/credits.ts`:

| Function | Purpose |
|---|---|
| `isAdmin(user)` | `role === "admin"`, strictly |
| `hasUnlimitedCredits(user)` | The unlimited-credit rule (admins) |
| `requestHasUnlimitedCredits(req)` | Same, for the authenticated request user (`req.auth`, set from the server-side session) |
| `requireCredits(account, amount)` | Check without spending; throws `402` when a normal user can't cover it |
| `consumeCredits(userId, amount)` | Charge. Re-reads role and balance from MongoDB; admins are never charged; normal users are debited atomically (`credits >= amount`, `role != admin` in the same update), so concurrent requests cannot overspend |

Amounts must be positive safe integers; anything else is a programming error.

## Current usage

No operation consumes credits today: inspection, IndexNow notifications, Google
inspection and bulk submission do not check or spend them, and every existing
user keeps working exactly as before. A future credit-consuming operation must
call `consumeCredits(authenticatedUser(req).id, cost)` **after** its ownership
checks and before queuing paid work.

Request-size bounds (`MAX_BULK_URLS`, `MAX_BATCH_URLS`, page sizes) and abuse
throttles are resource protections, not credits, and apply to admins too.

## Authorization is separate

Unlimited credits grant **no** additional data access. Admins are subject to
the same ownership checks as everyone else; nothing in the authorization layer
reads the role.

## Granting admin

There is deliberately no API for changing a role — users cannot promote
themselves, and registration ignores any `role`, `credits` or `plan` it is sent.
An operator with database access sets the role directly, for example in
`mongosh`:

```js
db.users.updateOne({ email: "person@example.com" }, { $set: { role: "admin" } })
```

The change applies to the user's next request (the role is re-read per request).
