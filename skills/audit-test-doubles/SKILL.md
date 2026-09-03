---
name: audit-test-doubles
description: Finds tests that pass whether or not the production code is correct, by auditing how mocks, stubs, fakes and spies are set up and asserted. Use when reviewing test quality, when a bug shipped despite green tests, when the user asks whether tests are meaningful or asks to audit, improve or review tests, or when a test suite passes and you want to know if it proves anything.
license: MIT
metadata:
  author: waqarqasim
  version: "1.0"
---

# Audit test doubles

A test built on a loosely configured double can pass whether or not the code under test is
correct. It is not a weak test; it is a test measuring the value the test itself supplied.

Works with NSubstitute, Moq, FakeItEasy, Jest, Sinon, unittest.mock, pytest-mock, gomock and
Mockito — the failure modes are the same shape in all of them.

## Procedure

Given a test file, a directory, or a diff, check each of the following.

### 1. Stubbed loosely, never asserted

The most common and most expensive case.

```csharp
// The double answers ANY call matching the shape.
_pricing.Lookup(Arg.Any<string>(), Arg.Any<Guid>()).Returns(19.99m);

var result = _sut.Quote(sku);

result.ShouldBe(19.99m);          // green even if Quote passed the WRONG id
```

The production code can pass the branch id where the warehouse id belongs, get the stubbed
answer anyway, and the assertion on the return value still holds.

**Fix — key the stub, and assert the call:**

```csharp
_pricing.Lookup(sku, warehouseId).Returns(19.99m);

result.ShouldBe(19.99m);
_pricing.Received(1).Lookup(sku, warehouseId);
```

**How to find it:** files that configure a double with a wildcard matcher and never assert
an interaction.

```bash
# adapt the matcher/assertion names to the framework in use
grep -rl 'Arg\.Any<'  --include=*.cs tests | sort > /tmp/loose.txt
grep -rl 'Received('  --include=*.cs tests | sort > /tmp/asserted.txt
comm -23 /tmp/loose.txt /tmp/asserted.txt
```

Report this as a **signal, not a verdict**. A query test whose assertion *is* the returned
value legitimately needs no interaction assertion. Judge each file; do not report the count
as a defect count.

### 2. A wildcard matcher where the argument is the behaviour

`Arg.Any<string>()` cannot catch a typo. If the production code calls
`IsEnabled("prochurement.approvals")`, a wildcard stub returns the happy value and the test
stays green forever.

Key the stub to the exact expected value and let anything else fall to the default.

### 3. New interface members defaulting silently

Adding a member to an interface breaks every hand-written implementation — the compiler sees
to that. It breaks no auto-generated double: those return `default` for the new member,
silently.

The tests written *for* the new behaviour pass, because they stub it explicitly. Every
*other* test now runs a path it was never meant to and asserts nothing about it.

**Check:** for any interface changed in the diff, find every place it is doubled and confirm
the new member is stubbed explicitly — including where the correct value is the default. An
explicit default is a decision; an implicit one is an accident that reads the same.

### 4. Over-mocking

A test that doubles everything the subject touches asserts only that the subject calls the
methods the author expected, in the order they expected. It breaks on every refactor and
catches no defect. Where the collaborator is pure, cheap and deterministic, use the real
thing.

### 5. Assertions on things that are not the behaviour

- **Prose.** `ShouldContain("Order — pending")` breaks when the string is translated,
  encoded, or reworded, and none of those are the behaviour. Anchor on a stable hook and the
  data separately.
- **Counts over growing sets.** `Permissions.Count.ShouldBe(47)` teaches people to update
  the number, including on the day something is deleted by accident. Assert the rule, plus a
  checked-in list compared in **both** directions.
- **Snapshots nobody reads.** An approved snapshot accepted without review records the
  behaviour at the moment someone stopped paying attention.

### 6. Setup that cannot fail

Doubles configured to throw or return a failure in setup, with no test exercising that path.
Dead configuration reads as coverage.

## Report

For each finding:

| field | content |
| --- | --- |
| location | `file:line` |
| pattern | which of the above |
| why it cannot fail | the concrete production change that would go undetected |
| fix | the smallest edit that makes the test watch the behaviour |

Rank by **what a passing version of this test currently permits**, not by how many there are.

Then verify one: apply the fix, break the production behaviour it now claims to watch, and
confirm it turns red. An audit that does not demonstrate at least one catch is a list of
opinions.

## Rules

- **A grep is a signal, not a defect count.** Say so when reporting numbers.
- **Never rewrite a test to match current behaviour.** That converts an assertion into a
  transcript, and the bug becomes the specification.
- **The question to ask of every test:** if I broke the behaviour this test is named after,
  which line goes red? If you cannot name the line, the test is measuring something else.
