


# Student Resource Progression — Product & Engineering Decisions

## 1. Product Scope

The progression system is exclusively based on **academic resources uploaded by students**.

Existing resource entities such as `UserFile` and `Book` must **not** be repurposed to implement student-resource progression. A dedicated student-resource model and its associated contribution/progression records should be used.

---

## 2. Resource Approval & Eligibility

A student-uploaded resource does **not** contribute to the student's progression when it is initially uploaded.

A resource becomes eligible to contribute only when an administrator explicitly changes its status to:

```text
APPROVED
```

Therefore:

* `PENDING` resources do not contribute.
* `REJECTED` resources do not contribute.
* `ARCHIVED` resources do not contribute.
* Only `APPROVED` resources can increase a student's daily goal progress.

The approval status must be treated as the source of truth for determining whether a resource is currently eligible to contribute.

---

## 3. Daily Goal

The daily contribution target is:

> **3 approved student resources per calendar day.**

The calendar day must be evaluated using the:

```text
Africa/Lagos
```

timezone.

For example, a resource approved at `23:30` Lagos time belongs to that Lagos calendar day, regardless of the server's timezone.

### Goal Progress

The goal percentage is calculated from the number of eligible approved resources contributed during the current Lagos calendar day.

The UI must display only the following progression states:

```text
0%
33%
66%
100%
```

The displayed progress must never exceed `100%`.

For example, if the daily target is 3:

| Approved Resources | Display |
| -----------------: | ------: |
|                  0 |      0% |
|                  1 |     33% |
|                  2 |     66% |
|                 3+ |    100% |

Once the user reaches 3 approved resources, additional approved resources must **not increase the displayed percentage beyond 100%**.

---

## 4. Maximum Daily Submissions

The system must enforce a maximum number of resource submissions a student can make per calendar day.

**Agreed daily submission cap: `A student may submit at most 6 resources per Africa/Lagos calendar day. Only approved resources contribute to the daily goal; the goal remains capped at 3`**

This limit applies to submissions, not approvals.

For example, with the agreed cap of 6:

2.

```text
Student submits 6 resources
        ↓
No additional submissions allowed that day
        ↓
Admins can independently approve/reject those resources
```

The cap must be enforced **server-side**. Client-side validation alone is insufficient.

> **Implementation note:** The submission limit and the daily progression target are separate rules. A student may submit more resources than are required to complete the daily goal, subject to the agreed submission cap.

---

## 5. Contribution Uniqueness

An approved resource can contribute to progression **only once**.

Approval events, status changes, retries, duplicate API requests, or administrative updates must not cause the same resource to be counted multiple times.

The backend should enforce this through a database-level uniqueness constraint where appropriate.

Conceptually:

```text
StudentResource
       │
       │ approved
       ▼
ResourceContribution
       │
       └── Can exist only once per resource
```

This makes the contribution calculation idempotent and prevents accidental double-counting.

---

## 6. Rejected and Archived Resources

A resource's contribution is conditional on its current eligibility.

If a previously approved resource is subsequently:

```text
REJECTED
```

or

```text
ARCHIVED
```

its contribution must be revoked.

The system must then safely recalculate the affected user's progression.

Example:

```text
3 approved resources
        ↓
100% daily goal

One resource becomes ARCHIVED
        ↓
2 eligible resources remain
        ↓
66% daily goal
```

Recalculation must be deterministic and must not create duplicate contribution records.

---

## 7. Daily Goal Completion

A daily goal is considered **completed** when the student reaches the required number of eligible approved resources for that Lagos calendar day.

Current target:

```text
3 approved resources
```

Completion should be derived from the student's eligible contributions for that day rather than from a manually toggled boolean.

This ensures that if an approved resource is later revoked, the system can correctly recalculate whether the daily goal remains complete.

---

## 8. Streak Calculation

A streak represents **consecutive calendar days on which the student completed their daily goal**.

For example:

```text
Monday     ✅
Tuesday    ✅
Wednesday  ✅
Thursday   ❌
Friday     ✅
```

The student's completed streak before Thursday is:

```text
3 days
```

Friday starts a new streak because Thursday's goal was not completed.

The streak must respect the:

```text
Africa/Lagos
```

calendar boundary.

---

## 9. Consistency Score

Consistency is a **calculated rolling 7-day percentage**.

It is not the authoritative stored source of truth.

The system should derive consistency from the user's daily goal completion history over the relevant rolling 7-day window.

Conceptually:

```text
Consistency =
Completed Goal Days / Eligible Days × 100
```

The underlying daily completion/contribution data remains the source of truth.

This means the consistency percentage can be recalculated at any time rather than relying on a potentially stale stored percentage.

---

## 10. User Progression

Each user has a single progression record:

```text
User
 └── 1:1 UserProgression
```

`UserProgression` is responsible for representing the user's current progression state.

It may reference a rank definition:

```text
UserProgression
 └── N:1 RankDefinition
```

Rank definitions should remain configuration/data-driven rather than being hardcoded throughout application logic.

---

## 11. Rank Trigger

The rank advancement rule must be explicit and deterministic.

**Agreed rank trigger: `A user advances one rank for every 10 lifetime approved qualifying resources. Rank progression is independent of streaks and daily-goal completion`**

The backend must determine rank advancement from the defined progression rule rather than allowing the frontend to decide when a user has advanced.

For example, if the agreed rule is based on accumulated approved contributions:

```text
Approved contributions
        ↓
Progression calculation
        ↓
Rank threshold
        ↓
Current RankDefinition
```

The exact threshold/rule must be documented here before implementation so that Backend, Frontend, and QA use the same definition.

Rank trigger: Rank thresholds are cumulative approved qualifying-resource totals:
Novice: 0
Amateur: 10
Senior: 20
Enthusiast: 30
Professional: 40
Expert: 50
Legend: 60
Veteran: 70
Master: 80
Ultimate: 90

Ultimate is the terminal rank. A user with 90 or more approved qualifying resources remains Ultimate.


## 12. Administrative Visibility

Administrators must be able to query **every user's progression**.

The admin system should be able to retrieve, at minimum:

* User
* Current rank
* Current progression state
* Current daily goal status
* Current streak
* Rolling 7-day consistency
* Approved contribution count
* Relevant progression history

Progress must not be visible only through the student's own dashboard.

The backend should therefore provide an administrative query/API capable of retrieving progression data for any user, with appropriate authorization.

---

## 13. File Upload Limits

Student resource uploads must enforce a **server-side file-size limit**.

The recommended maximum is:

```text
50 MB
```

This should be retained unless the configured Supabase Storage bucket has a lower effective limit.

The validation must occur on the server/backend rather than relying exclusively on frontend validation.

The frontend may also validate the size for user experience, but the backend remains authoritative.

---

## 14. Timezone

All daily-goal, streak, and rolling-calendar calculations must use:

```text
Africa/Lagos
```

The application must not rely on the server's local timezone for determining whether a daily goal has been completed.

This is particularly important around:

* Daily goal resets
* Approval timestamps
* Streak calculations
* Contribution dates
* Rolling 7-day consistency

Timestamps may be stored in UTC, but calendar-day calculations must be performed using `Africa/Lagos`.

---

## 15. Existing Models Must Not Be Repurposed

The existing:

```text
UserFile
Book
```

models must **not** be modified or repurposed to represent the new student-resource progression workflow.

The progression domain should have its own dedicated entities.

The intended relationship is:

```text
User
 ├── 1:N StudentResource
 ├── 1:N DailyGoal
 └── 1:1 UserProgression

StudentResource
 └── 1:1 ResourceContribution

DailyGoal
 └── 1:N ResourceContribution

UserProgression
 └── N:1 RankDefinition
```

This separation keeps the existing book/file domain independent from the new student contribution and progression domain.

---

# Engineering Principles

The implementation should follow these principles:

1. **Backend is authoritative** for approval, contribution, progression, and limits.
2. **Database constraints** should prevent duplicate contributions.
3. **Approved status determines eligibility**.
4. **Progress is derived from eligible contributions**, not manually incremented counters.
5. **Daily calculations use `Africa/Lagos`**.
6. **Streak and consistency are derived from historical daily completion data**.
7. **Consistency is a calculated rolling 7-day metric, not the source of truth.**
8. **Revoking an approval must trigger safe recalculation.**
9. **Frontend percentages must never exceed 100%.**
10. **Existing `UserFile` and `Book` models remain untouched for this feature.**
11. **Administrative users must have complete visibility into user progression.**
12. **File-size limits must be enforced server-side.**




