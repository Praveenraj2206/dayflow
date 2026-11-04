# Dayflow fictional workforce policy

**simplified mock policy, not legal advice**

Version: `dayflow-usd-v1`.
Status: **Implementation baseline following review. Not active until a reviewer
signs the exact compiled hash in Dayflow.**

## Assumptions included in the application sign-off

Every item below is an **ASSUMPTION** of this fictional demonstration policy, not
a statement of employment law. These identify new or clarified defaults in this
revision. Their operative clauses and golden examples appear below.

| ID | New or clarified default |
|---|---|
| A01 | **ASSUMPTION:** Approved unpaid leave reduces salaried non-exempt weekly salary by `salary x unpaid_minutes / 2400`, capped at that salary. Unapproved absence alone does not reduce salary. The converted hourly rate is unchanged. |
| A02 | **ASSUMPTION:** Monetary trace lines aggregate by employee, component, and workweek, except meal premiums by shift-start date. Round after aggregation, not per minute/shift/day. Exempt annual salary is allocated as annual salary / 52 to each week. |
| A03 | **ASSUMPTION:** Overlaps within actual work, schedules, breaks, or approved leave, and actual work overlapping approved leave, block final pay and raise schedule-conflict exceptions. Valid actual work matching its schedule is not an overlap error. Unknown missed work cannot be silently valued as zero. |
| A04 | **ASSUMPTION:** Forecasts subtract planned unpaid break minutes. Overnight planned breaks require positioned intervals so daily/weekly allocation is unambiguous. Incomplete forecasts do not invent overtime totals. |
| A05 | **ASSUMPTION:** A scheduled shift that has ended by `as_of`, has no punches, and is not fully covered by approved leave raises a missed-shift subtype of missed-punch. Future shifts are not missed shifts. Confirmed no-work absences remain attendance exceptions without an automatic salary deduction. |
| A06 | **ASSUMPTION:** Corrections apply only to open periods. Reviewers cannot approve their own timecards or their own authored corrections. Reducing paid time requires employee confirmation; otherwise evidence-backed manager attestation is allowed. |
| A07 | **ASSUMPTION:** Comp-off leave debits at leave start; eligible work accrues at work end. Debit first on ties. A later credit cannot cure an earlier negative balance. |
| A08 | **ASSUMPTION:** Every verification and approval recomputes the full pay period, not only changed days or weeks. Cross-period edits require all affected periods to be open and independently recomputed in one atomic approval. |
| A09 | **ASSUMPTION:** Midnight splits reset daily overtime, split actual breaks and differential minutes by instant, and reset weekly counters on Monday. Meals remain evaluated against the unsplit shift and charged to its start date/week. |
| A10 | **ASSUMPTION:** Salaried non-exempt daily premiums apply even below 40 worked hours; salary already covers base earnings for those hours. Unpaid-leave deductions do not reduce the converted base rate used for premiums. |
| A11 | **ASSUMPTION:** Night differential includes 22:00 and excludes 06:00. Meal thresholds, break deadlines, waiver limits, forecast limits, and attendance tolerance use the inclusive/exclusive boundaries explicitly tested below. |
| A12 | **ASSUMPTION:** The expanded unsupported-input boundaries below fail explicitly into manual review. A cap is a safety bound, never permission to accept invalid leave or discard comp-off. |

This is an invented demonstration policy, not a representation of federal, state,
or local employment law. Terms such as exempt and non-exempt are synthetic
employee classifications supplied in the dataset, not classifications determined
by Dayflow. All amounts are USD gross earnings. Taxes, benefits, withholding,
reimbursements, actual payroll disbursement, and legal compliance certification
are outside this policy.

### Explicitly out of scope

**ASSUMPTION A12:** This ruleset does not calculate taxes, net pay, insurance,
benefit deductions, garnishments, reimbursements, tips/tip credits, commissions,
piecework, prevailing wages, union agreements, multiple simultaneous jobs/rates,
holiday/seventh-day premiums, paid rest breaks, on-call/travel/training
classification, retroactive bonus allocation, termination payouts, partial
employment periods, payroll disbursement, multi-currency conversion, multi-country
rules, per-day jurisdiction, statutory salary-basis tests, protected-leave
eligibility, or legal employee classification. No statutory entitlements are
inferred from this invented policy.

Exempt bonus/differential/premium inputs, non-exempt comp-off, unsupported salaried
rosters, and salary/rate/type changes inside a workweek require manual review, not
ignored earnings or guessed conversions. Comp-off is not cashed out. Arbitrary
legal prose cannot be compiled automatically; unsupported rule types cannot be
signed as executable rules. Policy replay, schedule optimization, and
off-the-clock prompting remain deferred. No surveillance data is collected.

## DF-001 - Calendar, precision, and source records

- Each employee has one named IANA payroll timezone. The fixture uses
  `America/New_York`; the engine must also accept other valid IANA zones.
- A workday is local midnight to local midnight. A workweek is Monday local
  midnight through the following Monday. A pay period is two complete consecutive
  workweeks, anchored to a Monday.
- Punches, shifts, and breaks require timezone-aware timestamps at whole-minute
  precision. Store UTC instants and the named payroll timezone. Reject naive,
  nonexistent local times, inconsistent UTC offsets, and ambiguous local times
  without an explicit valid offset.
- Calculate elapsed worked minutes in UTC, including across daylight-saving
  transitions. Split work at local day/week/period boundaries. Never round punches.
  **ASSUMPTION A09:** A midnight-spanning shift remains one source shift; only its
  work/break segments are split. Daily worked-minute counters reset at each local
  midnight, and weekly straight-time counters reset at Monday midnight. Compute
  meal obligations once for the whole shift under DF-005. Retain neighboring
  shift context when a shift crosses a pay-period boundary.
- Work intervals are half-open: `[start, end)`. Breaks are unpaid, contained in
  their shift, and must not overlap. Overlapping work intervals, nonpositive
  durations, duplicated punch events, missing endpoints, and unsupported records
  require review. Do not silently drop or repair them. **ASSUMPTION A03:**
  Overlaps also raise schedule-conflict exceptions and make final pay incomplete;
  adjacent intervals with the same end/start instant are not overlaps. See the
  classification table in DF-006.
- Money and rate arithmetic uses decimal values, not binary floating point. Keep
  calculation precision of at least 28 significant digits. Display rates to six
  decimal places; do not reuse displayed rates for calculations.
- **ASSUMPTION A02:** Create one monetary trace line per employee, earnings
  component, and workweek: hourly base, non-exempt salary, extra straight time,
  exempt salary, night differential, weekly bonus, daily overtime premium, weekly
  overtime premium, double-time premium, hourly paid leave, non-exempt unpaid-leave
  deduction, or exempt unpaid-leave deduction. Deduction lines are negative.
  Multiple events of the same component in a week aggregate before rounding.
  Omit zero-value monetary lines; retain zero quantities in the calculation
  metadata. Meal premiums are the exception: one line per employee/local
  shift-start date, attributed to that date's workweek.
- Round each aggregated monetary line to cents using ROUND_HALF_UP. Do not round
  its contributing minute, day, shift, or leave-event amounts. The paycheck total
  is the sum of the rounded signed lines across both weeks. Retain unrounded
  expressions, minute quantities, source-event contributions, and clause IDs in
  each line. Informational regular-rate and comp-off ledger records are not
  additional earnings lines. Examples G20-G21 show why granularity matters.

## DF-002 - Employee rates and base earnings

- Hourly non-exempt employees earn their configured hourly base rate for every
  worked minute, plus approved paid-leave minutes at that base rate.
- Salaried non-exempt employees have a weekly salary covering 40 straight-time
  hours. Their converted base hourly rate is weekly salary / 40. They receive
  weekly salary less the approved unpaid-leave deduction in DF-007, plus converted
  base rate for worked hours exceeding 40. **ASSUMPTIONS A01/A10:** Below-40
  attendance without approved unpaid leave does not itself reduce salary; daily
  overtime/double-time premiums still apply. Paid leave does not count as worked
  hours or create additional straight-time pay on top of salary.
- Salaried exempt employees receive annual salary / 26 before rounding for a
  complete biweekly period, subject only to DF-007. **ASSUMPTION A02:** Allocate
  annual salary / 52 to each of the two weekly base lines; round each line under
  DF-001, rather than rounding annual salary / 26 once. The rounded paycheck can
  consequently differ by one cent from that single-rounding shortcut. They
  receive no hourly overtime, night differential, regular-rate bonus allocation,
  or meal premium under this fictional policy.
- All base rates and salaries must be positive. Rate/salary/classification changes
  inside a workweek are unsupported and require manual review; the model cannot
  alter employee compensation or classification.

## DF-003 - Night differential and regular rate

- Non-exempt employees earn a $2.00 differential per actual worked hour between
  22:00 and 06:00 in their payroll timezone. Unpaid breaks and leave do not earn it.
  **ASSUMPTION A11:** Eligible local intervals are `[22:00, next 06:00)`;
  a minute starting at 22:00 earns differential, and one starting at 06:00 does
  not. Repeated DST minutes count by their distinct UTC instants.
- A non-exempt employee can have an approved, nonnegative weekly nondiscretionary
  bonus, explicitly assigned to a workweek. The full bonus is paid once that week.
- For each workweek with worked hours W > 0:
  `regular_rate = base_hourly_rate + (night_differential + weekly_bonus) / W`.
  For salaried non-exempt employees, use the converted base hourly rate from
  DF-002. This is a deliberately simplified salary allocation rule.
- Overtime premium uses this regular rate. Differential and bonus are paid as
  separate base-earnings lines; do not pay them a second time through regular rate.
- If W is zero, use base hourly rate for informational display only. A positive
  bonus with zero worked hours is unsupported and blocks a final calculation.
- Leave pay, meal premiums, overtime premiums, and exempt salary deductions are
  excluded from the regular-rate numerator. **ASSUMPTION A01:** Non-exempt
  unpaid-leave deductions also do not alter the converted base hourly rate or
  enter the numerator. Do not divide a reduced salary by worked hours to infer a
  different rate.

## DF-004 - Daily and weekly overtime without double counting

- Applies only to hourly and salaried non-exempt employees.
- Within each local day, the first 480 worked minutes are straight time, the next
  240 worked minutes are daily overtime, and further worked minutes are double
  time: the double-time boundary is 480 + 240 = 720 worked minutes. Unpaid breaks
  and leave do not count as work.
- Within each workweek, count only the minutes that remain daily straight time.
  Minutes in that pool exceeding 2,400 become weekly overtime, allocated in
  chronological order. Daily overtime and double time do not count toward this
  pool, so no minute receives both daily and weekly premiums.
- All worked hours already receive base earnings under DF-002. Add 0.5 times the
  weekly regular rate for each daily or weekly overtime hour. Add 1.0 times the
  weekly regular rate for each double-time hour.
- No seventh-consecutive-day or holiday multiplier exists in this mock policy.
  Do not import such rules from reference projects.
- Salaried exempt employees receive no overtime regardless of hours worked.
- **ASSUMPTION A10:** For salaried non-exempt employees, daily premiums are added
  even when total weekly work is below 40 hours; do not add a second hourly-base
  payment for those salary-covered hours. Additional straight-time pay starts
  only above 40 actual worked hours. Examples G23-G24 show both salary coverage
  and interaction with an approved unpaid-leave deduction.

## DF-005 - Meal breaks and premiums

- Meal requirements apply to non-exempt employees per complete shift, before
  splitting that shift at midnight. Exempt employees have attendance visibility
  but no meal-premium calculation.
- A shift with more than 300 worked minutes needs one uninterrupted unpaid meal
  of at least 30 minutes, starting no later than 300 elapsed minutes after shift
  start. A shift with more than 600 worked minutes needs a second such meal,
  starting no later than 600 elapsed minutes after shift start.
- Elapsed meal deadlines include earlier unpaid breaks; worked-minute thresholds
  exclude them. A second meal must be a distinct, nonoverlapping break after the
  first. Short breaks cannot be combined into a qualifying meal.
- First-meal waiver is valid only when worked minutes are at most 360 and a
  separate employee attestation explicitly approves that waiver.
- Second-meal waiver is valid only when worked minutes are at most 720, the first
  meal requirement was satisfied by a qualifying break (not waived), and a
  separate employee attestation explicitly approves the second waiver.
- A late/short/missing required meal creates a policy-breach exception and a
  premium of one hour at the regular rate of the workweek containing shift start.
  At most one meal premium is paid per employee per local shift-start date, even
  if multiple meals or shifts violate the rule. Use one trace line per such date.
  **ASSUMPTIONS A09/A11:** This date is not changed by a midnight split. More than
  300/600 minutes means 301/601 first triggers the requirement; exactly 30 break
  minutes qualifies; a break starting at elapsed minute 300/600 is on time;
  301/601 is late. Waiver limits include exactly 360/720 worked minutes.
- Attestations are trusted structured records created by an authenticated
  employee, not statements extracted from a note. The model cannot create,
  change, or assume an attestation. Do not invent an unpaid break to remove a
  premium; accurate records can retain a payable meal violation.

## DF-006 - Attendance, schedule conflict, and overtime risk

- Expected shifts and actual punches are separate sources. A scheduled boundary
  is context for a suggested correction, never proof that work occurred.
- Missing clock-in/out, a duplicated event, or an unmatched event creates a
  missed-punch exception. Pay for incomplete records is explicitly incomplete,
  with total and correction delta unavailable; known trace fragments may be shown.
- **ASSUMPTION A05:** A scheduled shift ending at or before `as_of` with no
  punches and without full approved-leave coverage raises `missed_shift` within
  the missed-punch detector family. Partial leave covers only its actual
  interval; do not excuse the rest of the shift. A future shift raises no such
  exception. Unknown work makes pay incomplete; do not infer zero work from
  missing punches. A separately attested no-work absence resolves that
  uncertainty but leaves the attendance exception and does not itself approve
  unpaid leave or authorize a salary deduction.
- Overlapping scheduled shifts, overlapping actual work, actual work overlapping
  approved leave, an unscheduled actual shift, or an actual start/end differing
  from schedule by more than 15 minutes creates a schedule-conflict exception.
  Exactly 15 minutes is within tolerance.
  **ASSUMPTION A03:** All overlaps in the table below block final pay as well as
  raising schedule conflict. A simple nonoverlapping schedule deviation or
  unscheduled shift is an exception, not evidence that known work is unpaid.
- For each non-exempt employee/week, project hours from complete actual shifts
  already ended by an explicit `as_of` instant plus scheduled shifts starting at
  or after that instant. Never count the same shift twice. A shift in progress
  or an unresolved punch makes the forecast incomplete rather than guessed.
- **ASSUMPTION A04:** Each scheduled shift carries `planned_unpaid_break_minutes`,
  a nonnegative integer strictly less than elapsed shift minutes. Project its
  work as UTC elapsed shift minutes minus those planned minutes. These planned
  breaks never become actual unpaid breaks automatically. For a schedule
  spanning midnight/week/period boundaries, require contained, nonoverlapping
  planned break intervals whose durations equal the planned minute total, so
  projected daily/weekly work can be allocated exactly. Missing placement makes
  that forecast incomplete; it does not invalidate independently complete actual
  pay records. Fully approved leave replaces, rather than adds to, scheduled
  work in the forecast; partially approved leave subtracts only its covered
  planned-work intervals and requires positioned planned breaks.
- Projected work above 2,400 minutes in a week, or above 480 minutes in a day,
  creates an overtime-risk exception. This is a forecast, not an earned-pay line.
- A complete actual shift over 960 worked minutes creates a long-shift
  policy-breach exception. All recorded work remains payable. Manager
  acknowledgment of overtime, long shifts, attendance issues, or payable meal
  violations is allowed; do not erase worked time to make detectors green.
- Salaried non-exempt and exempt employees retain attendance and leave
  exceptions even when their guaranteed salary is unchanged.

### Invalid records versus payable exceptions

**ASSUMPTIONS A03/A05/A12:** A blocked final calculation returns
`status=incomplete`, `total=null`, and `delta=null`, with specific reasons and
any clearly labelled partial traces. "No" below means the condition alone does
not block a final calculation; other invalid conditions can still block it.

| Condition | Detector classification | Blocks final pay? | Required treatment |
|---|---|---|---|
| Missing endpoint, unmatched/duplicate punch event | Missed-punch | Yes | Obtain evidenced correction; never invent an endpoint or drop a duplicate. |
| Ended scheduled shift with no punches and no full approved leave | Missed-punch: missed-shift | Yes, while work is unknown | Confirm actual work or attest no-work absence; retain attendance issue. |
| Separately confirmed no-work/unapproved absence | Policy breach: attendance | No | No automatic salary deduction; only approved unpaid leave invokes DF-007. |
| Overlapping actual work intervals | Schedule conflict | Yes | Correct records with evidence; do not pay twice or silently merge. |
| Overlapping scheduled shifts | Schedule conflict | Yes | Authorized roster correction is required; a punch proposal cannot change the roster. |
| Overlapping actual work and approved leave | Schedule conflict | Yes | Resolve via evidenced time correction or authorized leave workflow. |
| Overlapping break intervals, or overlapping approved leave intervals | Schedule conflict | Yes | Resolve invalid source intervals; do not silently union/subtract them. |
| Naive/invalid-zone/invalid-offset timestamps, nonpositive interval, outside-shift break, inconsistent leave minutes, or excess daily leave | Policy breach: invalid record | Yes | Correct invalid source data; no guessed pay. |
| Unsupported compensation/rules, positive bonus with zero worked hours, insufficient/over-cap comp-off | Policy breach: unsupported input/bank invariant | Yes | Explicit manual review; no silent defaults, ignored input, or clamping. |
| Meal missing, short, late, or invalidly waived | Policy breach: meal | No | Pay the one-per-start-date premium when required. |
| Actual overtime or long shift | Overtime evidence / policy breach: long shift | No | Pay all valid work and applicable premiums; acknowledge, never erase. |
| Nonoverlapping unscheduled work or boundary deviation greater than 15 minutes | Schedule conflict | No | Pay recorded work; review attendance/schedule issue. |
| Forecast above daily/weekly threshold | Overtime risk | No | Show projected minutes separately from earned pay. |
| In-progress shift or unpositioned overnight planned break | Forecast incomplete | Only if actual pay records are also incomplete | No guessed forecast; actual pay validity is assessed independently. |
| Closed period, missing correction evidence, self-approval, or stale candidate | Approval/workflow rejection | No effect on already valid stored pay; blocks correction commit | Keep existing records; require an eligible fresh approval path. |

## DF-007 - Paid leave, unpaid leave, and loss of pay

- The synthetic roster uses five scheduled eight-hour days per workweek for
  salaried staff. Leave records identify a date, kind, minutes, and approval.
  Each day can have at most 480 approved leave minutes; leave cannot overlap
  worked time. Approved leave must refer to a scheduled interval.
- Hourly employees receive approved paid leave at base rate. Unpaid leave earns
  no pay. Neither form of leave counts toward overtime or night differential.
- **ASSUMPTION A01:** For salaried non-exempt employees, sum approved unpaid
  leave minutes U within each week. Deduct
  `min(weekly_salary, weekly_salary x U / 2400)` from that week's salary.
  Approved paid leave does not reduce salary. Unapproved absences and partial
  attendance alone remain exceptions, not automatic salary deductions. Validate
  leave records before applying the cap: each salaried day is at most 480 minutes,
  and a five-day week supports at most 2,400 approved unpaid-leave minutes.
  More than that is invalid input, not a way to exercise the cap by discarding
  extra leave. Aggregate the week's deduction before cent rounding. The base
  salary line and negative deduction line remain separately visible.
- Salaried exempt employees retain salary for approved paid leave and
  partial-day absence. A full scheduled day of exactly 480 minutes of explicitly
  approved unpaid leave deducts annual salary / 260 from biweekly salary.
  An incomplete punch or an unapproved absence cannot authorize this deduction.
- At most ten full-day deductions apply to the biweekly period; deductions
  cannot exceed base period salary. Unsupported schedules, conflicting leave,
  or unsupported deduction requests require manual review.
  **ASSUMPTION A02:** Aggregate exempt deductions by the week containing each
  leave day, with at most five full-day deductions per week. Apply the cap to
  unrounded amounts before rounding trace lines. A proposed eleventh day is
  invalid, not an accepted zero-pay calculation.

## DF-008 - Exempt compensatory time

- Only salaried exempt employees have a comp-off bank. It is measured in integer
  minutes, not dollars, and is never substituted for non-exempt overtime.
- Complete work on an unscheduled local Saturday or Sunday earns one comp-off
  minute per worked minute after explicit manager approval of that work record.
  Split overnight work by local date before calculating weekend minutes.
- Approved comp-off leave consumes the requested scheduled leave minutes and
  preserves salary. Do not earn comp-off for leave or for scheduled weekend work.
- Balance must remain between zero and 4,800 minutes. Insufficient balance or an
  accrual exceeding the cap requires review; never clamp or discard minutes.
- **ASSUMPTION A07:** Timestamp a leave debit at the start of its approved leave
  interval, and an eligible accrual at the end of its approved work interval.
  Split cross-midnight work first; each eligible segment accrues at segment end,
  so weekend attribution remains exact. Apply events chronologically with a
  leave debit before an accrual at an identical instant. Validate balance after
  every event; later accruals cannot repair an earlier shortfall. Store opening
  balance, each event, and closing balance in the derivation. Accrual/debit is
  persisted only through the verified
  human-approval transaction, idempotently per source record.

## DF-009 - Corrections and verification boundaries

- A correction may add, replace, or remove punch/break events on its target
  timecard, but must cite a supported clause, specific source evidence, and a
  reason. **ASSUMPTION A06:** Every affected pay period must be open. Reject
  correction verification/commit on a closed period; retain read-only pay traces
  and history. Recheck open status during the approval transaction.
- **ASSUMPTION A06:** A correction that reduces paid work minutes on any affected
  local date requires explicit authenticated employee confirmation of that exact
  candidate revision. Adding or extending an unpaid break counts as a reduction.
  Increasing another day's time cannot offset this confirmation requirement.
  If an incomplete before-state prevents proving non-reduction, employee
  confirmation is required. Otherwise, each changed worked-time boundary needs
  either employee confirmation or a separately recorded manager attestation of
  reviewed evidence. An exact duplicate-event removal that leaves the union of
  worked intervals unchanged is not itself a paid-time reduction, but still
  requires duplicate evidence and an allowed attestation.
- The model can suggest boundaries; it cannot provide the required attestation
  itself. A note or scheduled shift alone is insufficient to verify a changed
  work boundary. Removing a duplicate event is allowed only with referenced
  duplicate-event evidence.
- Compensation, employee identity/type, leave approvals, waiver attestations,
  policy rules, and opening comp-off balances are not editable proposal fields.
  Their dedicated authorized workflows must maintain independent audit history.
- **ASSUMPTION A08:** Verification always recomputes the full two-week pay period,
  before and after the candidate, including all timecards, compensation inputs,
  bonuses, leave, meal-source context, and comp-off events. Approval repeats the
  full recomputation against current inputs inside its protected transaction.
  An edit affecting a neighboring period requires linked candidates, every
  affected period open, full recomputation of each, and a single atomic approval;
  never mutate neighboring-period earnings through a target-period-only patch.
  It checks valid intervals, allowed fields, evidence, salary/leave and
  comp-off invariants, policy signatures, and immutable input revisions.
- An incomplete before-state can become complete after an evidenced correction,
  but its dollar delta remains unavailable rather than treating unknown pay as
  zero. Show the computed after-state and the reason delta is unknown.
- Payable meal violations or earned overtime need not disappear after an accurate
  correction. Structural errors, unsupported rules, missing required evidence,
  stale revisions, or failed recomputation prevent committing.
- An authorized reviewer must explicitly approve a current verified candidate.
  **ASSUMPTION A06:** The reviewer must be a different person from the subject
  employee and from any human author of that correction revision. An employee
  can confirm a correction to their timecard but cannot approve it. A human
  proposer must obtain a different authorized reviewer; changing a UI role does
  not change identity. The system/model cannot count as a human approver.
  Approval atomically commits the timecard, associated bank effects, and audit
  event. Every manual revision requires fresh verification. The LLM has no
  database write or approval capability.

## DF-010 - Worked golden examples

### Example conventions

All examples are **simplified mock policy, not legal advice**. G01-G19 preserve
the original example order; G10 is intentionally revised. Examples are independent,
not additive. Amounts labelled "week" are weekly subtotals, not permission to
verify less than a full period. For a non-exempt hourly example, the other week
has no work/bonus/leave and contributes $0 unless specified. For a salaried example,
the other week is a normal roster with no adjustments unless specified.

Unless stated otherwise, work is non-exempt hourly, on daytime shifts without
night minutes/bonuses; any required meals are timely qualifying breaks, unpaid
and additional to the stated **worked** minutes. Examples explicitly showing a
missing/invalid meal override that convention. Attendance/schedule records match
unless a conflict is the subject of the case. Each complete shift is at most
960 worked minutes unless explicitly testing long-shift behavior. Meal examples
use a single local day. Monetary formulas below show the contributing components;
aggregate and round lines under DF-001.

For salaried examples, unspecified scheduled time is covered by independently
attested no-work absence, approved leave, or the stated normal roster, not unknown
punches. Salary is not automatically deducted for a confirmed unapproved absence.
Extra salaried work can raise payable schedule/attendance exceptions; the shown
totals do not claim those exceptions disappear. A "week subtotal" still requires
the unchanged other week to be present in full-period verification.

For boundary examples using $60/hour, each worked minute earns $1 base, each
overtime-premium minute $0.50, and each double-time-premium minute $1 when regular
rate equals base. This deliberately makes one-minute thresholds hand-checkable.

### Original examples, independently recalculated

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G01 | $20/hour; five eight-hour days: `40 x 20 = 800`; no premiums. | $800.00 |
| G02 | $20/hour; one 10-worked-hour day: base `10 x 20 = 200`; daily premium `(10 - 8) x 0.5 x 20 = 20`; `200 + 20 = 220`. | $220.00 |
| G03 | $20/hour; one 13-worked-hour day: base `13 x 20 = 260`; daily premium `4 x 0.5 x 20 = 40`; double-time premium `(13 - 12) x 20 = 20`; `260 + 40 + 20 = 320`. | $320.00 |
| G04 | $20/hour; six eight-hour days: base `48 x 20 = 960`; straight pool `6 x 8 = 48`; weekly premium `(48 - 40) x 0.5 x 20 = 80`; `960 + 80 = 1040`. | $1,040.00 |
| G05 | $20/hour; five 10-worked-hour days: base `50 x 20 = 1000`; daily premium `5 x 2 x 0.5 x 20 = 100`; straight pool `5 x 8 = 40`, weekly premium `0`; `1000 + 100 = 1100`. | $1,100.00 |
| G06 | $20/hour; five nine-hour days plus one eight-hour day: work `5 x 9 + 8 = 53`; base `53 x 20 = 1060`; daily premium `5 x 1 x 0.5 x 20 = 50`; straight pool `6 x 8 = 48`; weekly premium `8 x 0.5 x 20 = 80`; `1060 + 50 + 80 = 1190`. | $1,190.00 |
| G07 | $20/hour; five eight-worked-hour shifts, with eight total night hours, $84 weekly bonus, and one meal-violation start date: base `40 x 20 = 800`; night `8 x 2 = 16`; bonus `84`; regular rate `20 + (16 + 84)/40 = 22.50`; no daily/weekly OT; meal premium `1 x 22.50 = 22.50`; `800 + 16 + 84 + 22.50 = 922.50`. | $922.50 |
| G08 | $20/hour; six eight-hour days plus $96 bonus: base `48 x 20 = 960`; regular rate `20 + 96/48 = 22`; weekly premium `8 x 0.5 x 22 = 88`; `960 + 96 + 88 = 1144`. | $1,144.00 |
| G09 | Salaried non-exempt $800/week, six eight-hour days: converted rate `800/40 = 20`; extra base `(48 - 40) x 20 = 160`; weekly premium `8 x 0.5 x 20 = 80`; `800 + 160 + 80 = 1040` for that week; other week `800`. | $1,040.00 week; $1,840.00 period |
| G10 | **ASSUMPTION A01, revised:** Salaried non-exempt $800/week, four eight-worked-hour days and one approved 480-minute unpaid day: deduction `min(800, 800 x 480/2400) = 160`; salary `800 - 160 = 640`; no OT; other week `800`. | **$640.00 week; $1,440.00 period** |
| G11 | Exempt $52,000/year; weekly salary `52000/52 = 1000`; period base `1000 + 1000 = 2000`; one approved 480-minute unpaid day deducts `52000/260 = 200`; `2000 - 200 = 1800`. | $1,800.00 |
| G12 | Exempt $52,000/year; period salary `2 x (52000/52) = 2000`; overtime `0`; opening bank `60` plus `120` approved unscheduled Saturday minutes = `180`. | $2,000.00; bank 180 minutes |
| G13 | $20/hour; 32 worked hours and eight paid-leave hours: work `32 x 20 = 640`; leave `8 x 20 = 160`; OT counts only 32 hours; `640 + 160 = 800`. | $800.00 |
| G14 | $20/hour; 360 worked minutes without a meal, valid first waiver: base `360/60 x 20 = 120`; `360 <= 360`, so meal premium `0`; `120 + 0 = 120`. | $120.00 |
| G15 | $20/hour; 420 worked minutes without a meal: waiver invalid because `420 > 360`; base `420/60 x 20 = 140`; meal premium `1 x 20 = 20`; `140 + 20 = 160`. | $160.00 |
| G16 | $20/hour; one worked minute: base `20 x 1/60 = 0.333333...`; round the weekly base line half-up to `0.33`. | $0.33 |
| G17 | New York `2026-03-08T01:30:00-05:00` to `2026-03-08T03:30:00-04:00`: UTC `06:30` to `07:30` = `60` minutes; base `60/60 x 20 = 20`; night `60/60 x 2 = 2`; `20 + 2 = 22`. | $22.00 |
| G18 | New York `2026-11-01T00:30:00-04:00` to `2026-11-01T02:30:00-05:00`: UTC `04:30` to `07:30` = `180` minutes; base `180/60 x 20 = 60`; night `180/60 x 2 = 6`; `60 + 6 = 66`. | $66.00 |
| G19 | Clock-in but no clock-out; scheduled end is unconfirmed: `end - start` is undefined, so worked minutes, total, and delta are unknown, not zero. | Incomplete; total/delta null |

### Granularity, overnight allocation, and salary interactions

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G20 | **ASSUMPTION A02:** Two one-minute daytime work events in the same week at $20/hour: weekly base `20 x (1 + 1)/60 = 0.666666... -> 0.67`. The forbidden per-event shortcut gives `0.33 + 0.33 = 0.66`, one cent less. | $0.67, not $0.66 |
| G21 | **ASSUMPTION A02:** One such minute in each week: each weekly base `20/60 -> 0.33`; paycheck `0.33 + 0.33 = 0.66`. Aggregating across weeks would incorrectly give `0.67`. Exempt rounding companion: annual salary `$52,000.26`; each weekly base `52000.26/52 = 1000.005 -> 1000.01`; period `2000.02`, not single-rounded `52000.26/26 = 2000.01`. | Hourly $0.66; exempt $2,000.02 |
| G22 | **ASSUMPTION A09:** New York Mon `2026-11-09 22:00-05:00` to Tue `2026-11-10 08:00-05:00`, break Tue `02:00-02:30`: total `(600 - 30) = 570` work minutes; Mon `120`, Tue `(480 - 30) = 450`, so neither day exceeds `480`; base `570/60 x 20 = 190`; night `(480 - 30)/60 x 2 = 15`; regular rate `20 + 15/9.5 = 21.578947...`; first meal starts elapsed `240 <= 300`, second not required because `570 <= 600`; `190 + 15 = 205`. | $205.00; no daily OT, one qualifying meal |
| G23 | **ASSUMPTION A10:** Salaried non-exempt $800/week; one 10-worked-hour day, no unpaid leave: rate `800/40 = 20`; daily premium `2 x 0.5 x 20 = 20`; extra straight time `max(10 - 40, 0) x 20 = 0`; week `800 + 20 = 820`; other week `800`. | $820.00 week; $1,620.00 period |
| G24 | **ASSUMPTIONS A01/A10:** Same salary; daytime work `10 + 8 + 8 + 6 = 32` hours plus approved eight-hour unpaid leave on the fifth scheduled day: deduction `800 x 480/2400 = 160`; rate still `20`; daily premium `2 x 0.5 x 20 = 20`; week `800 - 160 + 20 = 660`; other week `800`. | $660.00 week; $1,460.00 period |

### Daily and weekly overtime thresholds

Each row uses $60/hour and complete records with required meals satisfied.

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G25 | At `479` worked minutes: base `479`, daily premium `0`, total `479`. Exactly `480`: base `480 x 1 = 480`; daily premium `max(480 - 480, 0) x 0.5 = 0`; total `480`. | $479.00 below / $480.00 at threshold; no daily OT |
| G26 | `481` worked minutes: base `481`; daily premium `(481 - 480) x 0.5 = 0.50`; `481 + 0.50 = 481.50`. | $481.50; one daily OT minute |
| G27 | At `719` worked minutes: base `719`; daily premium `(719 - 480) x 0.5 = 119.50`; `719 + 119.50 = 838.50`. Exactly `720`: base `720`; daily premium `240 x 0.5 = 120`; double-time premium `0`; `720 + 120 = 840`. | $838.50 below / $840.00 at threshold; no double time |
| G28 | `721` worked minutes: base `721`; daily premium `240 x 0.5 = 120`; double-time premium `1 x 1 = 1`; `721 + 120 + 1 = 842`. | $842.00; one double-time minute |
| G29 | Four `480`-minute days plus `479`: week `4 x 480 + 479 = 2399`; base `2399`, weekly premium `0`. Five `480`-minute days: week `5 x 480 = 2400`; base `2400`; weekly premium `0`; total `2400`. | $2,399.00 below / $2,400.00 at threshold; no weekly OT |
| G30 | Five `480`-minute days plus one minute on a sixth day: straight pool `2401`; base `2401`; weekly premium `(2401 - 2400) x 0.5 = 0.50`; `2401 + 0.50 = 2401.50`. | $2,401.50; one weekly OT minute |

### Meal thresholds, deadlines, waivers, and premium cap

Each row uses $60/hour, no night work or bonus, and one shift-start date.
Elapsed offsets are UTC elapsed minutes from shift start. In G33-G35, the
330 worked minutes come from the stated full span minus the actual break.

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G31 | `299` worked minutes without a meal: base `299`, meal `0`. At `300`, `300` is not greater than `300`; base `300`; meal `0`; total `300`. | $299.00 below / $300.00 at threshold; no meal requirement |
| G32 | `301` worked minutes, no meal/waiver: base `301`; first meal required; premium `60`; `301 + 60 = 361`. | $361.00 |
| G33 | Span `360`, break `[300,330)` of `30`, work `360 - 30 = 330`: first meal start `300 <= 300`, duration `30 >= 30`; base `330`; meal `0`. Companion span `361`, break `[300,331)` of `31`: work `361 - 31 = 330`, also qualifies with the same pay. | $330.00 with a 30- or 31-minute meal; deadline inclusive |
| G34 | Span `360`, break `[301,331)` of `30`, work `330`: first meal starts `301 > 300`; base `330`; premium `60`; `330 + 60 = 390`. | $390.00; one minute late |
| G35 | Span `359`, break `[240,269)` of `29`, work `359 - 29 = 330`: short break is unpaid but not a qualifying meal; base `330`; premium `60`; `330 + 60 = 390`. | $390.00; one minute too short |
| G36 | `359` worked minutes, valid first waiver: base `359`, premium `0`. At `360` without a meal, valid first-waiver attestation: `360 <= 360`; base `360`; premium `0`. With no attestation at `360`, `360 + 60 = 420`. | $359.00 below / $360.00 at waiver limit; $420.00 unwaived at limit |
| G37 | `361` worked minutes, no meal, first waiver requested: `361 > 360`, waiver invalid; base `361`; premium `60`; `361 + 60 = 421`. | $421.00 |
| G38 | `599` worked minutes with timely first meal: base `599`, daily premium `(599 - 480) x 0.5 = 59.50`, total `658.50`. At `600` with timely first meal only: no second meal because `600` is not greater than `600`; base `600`; daily premium `(600 - 480) x 0.5 = 60`; `600 + 60 = 660`. | $658.50 below / $660.00 at second-meal threshold |
| G39 | `601` worked minutes, timely first meal only, no second waiver: base `601`; daily premium `121 x 0.5 = 60.50`; missing second-meal premium `60`; `601 + 60.50 + 60 = 721.50`. | $721.50 |
| G40 | Span `720`, first break `[240,270)`, second `[600,630)`: work `720 - 30 - 30 = 660`; second starts exactly `600`; base `660`; daily premium `180 x 0.5 = 90`; meal `0`; `660 + 90 = 750`. If second break is `[601,631)`, same work but meal premium `60`, so `750 + 60 = 810`. | $750.00 on time; $810.00 one minute late |
| G41 | `719` worked minutes, qualifying first meal and valid second waiver: base `719`, daily premium `239 x 0.5 = 119.50`, meal `0`, total `838.50`. At `720`, first meal qualifies, second absent with valid second waiver: `720 <= 720`; base `720`; daily premium `240 x 0.5 = 120`; meal `0`; `720 + 120 = 840`. With no waiver attestation at `720` add `60`, giving `900`. | $838.50 below / $840.00 at waiver limit; $900.00 unwaived at limit |
| G42 | `721` worked minutes, first meal qualifies, second absent with waiver requested: `721 > 720`, waiver invalid; base `721`; daily premium `120`; double-time premium `1`; meal `60`; `721 + 120 + 1 + 60 = 902`. | $902.00 |
| G43 | `780` worked minutes without either meal: base `780`; daily premium `240 x 0.5 = 120`; double-time premium `60 x 1 = 60`; two missing meals but premium `1 x 60 = 60`; `780 + 120 + 60 + 60 = 1020`. | $1,020.00; one premium, not two |

### Differential, tolerance, forecast, and week boundary

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G44 | $60/hour; work `[21:59,22:00)`: one worked minute, zero night minutes; base `1`; differential `0`; total `1`. | $1.00 |
| G45 | $60/hour; work `[22:00,22:01)`: base `1`; night `2 x 1/60 = 0.033333... -> 0.03`; `1 + 0.03 = 1.03`. | $1.03; 22:00 included |
| G46 | $60/hour; work `[05:59,06:00)`: base `1`; night `2/60 -> 0.03`; `1 + 0.03 = 1.03`. | $1.03 |
| G47 | $60/hour; work `[06:00,06:01)`: base `1`; night `0`; total `1`. | $1.00; 06:00 excluded |
| G48 | $20/hour; schedule `09:00-17:30`, planned break `30`; actual `09:15-17:45` with a 30-minute break: boundary differences `15` and `15`, both within tolerance; work `(510 - 30)/60 = 8` hours; base `8 x 20 = 160`. Actual `09:14-17:44` instead differs by `14` at each boundary, still eight work hours and `8 x 20 = 160`. | $160.00 at 14 or 15 minutes; no boundary conflict |
| G49 | Same schedule; actual `09:16-17:46` with a 30-minute break: differences `16` and `16`, greater than `15`; work still `480` minutes; base `8 x 20 = 160`. | $160.00; schedule conflict, not incomplete |
| G50 | **ASSUMPTION A09:** $20/hour; New York Sun `2026-11-08T23:30:00-05:00` to Mon `2026-11-09T00:30:00-05:00`, inside one pay period: week 1 has `30` work/night minutes and week 2 has `30`; each week base `30/60 x 20 = 10` plus night `30/60 x 2 = 1`; `11 + 11 = 22`; no OT. Companion with 40 prior daytime hours in week 1: week 1 work `40.5`, base `40.5 x 20 = 810`, night `1`, regular rate `20 + 1/40.5 = 20.024691...`, weekly premium `0.5 x 0.5 x 20.024691... = 5.006172... -> 5.01`, subtotal `810 + 1 + 5.01 = 816.01`; week 2 resets and earns `10 + 1 = 11`, no weekly OT; period `816.01 + 11 = 827.01`. | $22.00 without prior work; $827.01 with prior work; Monday's 30 minutes are not week-1 OT |
| G51 | **ASSUMPTION A04:** Five future schedules each span `510` elapsed minutes with `30` planned unpaid minutes: each `510 - 30 = 480`; week `5 x 480 = 2400`, no daily/weekly risk. With the last schedule extended by one minute: last `511 - 30 = 481`, week `4 x 480 + 481 = 2401`, so both daily and weekly risk. Future actual earnings are not calculated. | Forecast 2,400: no risk; 2,401: daily and weekly risk |
| G52 | **ASSUMPTIONS A03/A05:** Ended schedule has `480` planned work minutes but zero punches and zero approved leave: actual `W` is unknown, not `0`; missed-shift, incomplete pay. If approved leave covers all `480`, uncovered minutes `480 - 480 = 0`, no missed-shift; partial coverage of `240` leaves `480 - 240 = 240` unknown minutes, so missed-shift remains. | Unknown total unless work/absence is resolved; no missed-shift for a future schedule |

### Comp-off ordering and cap boundaries

Exempt examples use annual salary $52,000: weekly base `52000/52 = 1000`,
period base `1000 + 1000 = 2000`, no overtime or dollar value for bank movements.
All accruals below are approved, unscheduled weekend work; no work overlaps leave.

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G53 | Opening bank `4799`; one eligible worked minute credits at work end: `4799 + 1 = 4800`, exactly the cap. | $2,000.00; bank 4,800 |
| G54 | Opening bank `4800`; one eligible minute would produce `4800 + 1 = 4801 > 4800`. Do not clamp to `4800` or discard `1`. Tentative salary base is `2000`, but bank invariant blocks finalization. | Incomplete; total null; bank event not committed |
| G55 | Opening bank `30`; approved comp-off leave `[09:30,10:00)` debits `30` at `09:30`: `30 - 30 = 0`. With opening `29`, `29 - 30 = -1 < 0`, so reject; a later credit cannot repair it. | $2,000.00 and bank 0 for opening 30; incomplete for opening 29 |
| G56 | **ASSUMPTION A07:** Sunday approved unscheduled work `[23:30,Monday 00:00)` earns `30` at Monday `00:00`; distinct scheduled Monday comp-off leave `[00:00,00:30)` debits `30` at `00:00`. This employee's weekday eight-work-hour roster starts at midnight, so leave is scheduled and the Sunday work is not. Opening `30`: debit first `30 - 30 = 0`, then credit `0 + 30 = 30`, valid. Opening `0`: debit first `0 - 30 = -30`, invalid before the credit; do not net to zero. Both events are inside the period, not at its opening boundary. | Opening 30: $2,000.00, closing bank 30; opening 0: incomplete |

### Deduction boundaries and invalid overlap examples

| ID | Case and arithmetic | Expected result |
|---|---|---|
| G57 | **ASSUMPTION A01:** Non-exempt salary $800/week, one approved unpaid minute: raw deduction `800 x 1/2400 = 0.333333...`; weekly deduction line `-0.33`; base `800.00`; week `800 - 0.33 = 799.67`; other week `800`. Two one-minute leave events in that week aggregate to `800 x 2/2400 = 0.666666... -> 0.67`, giving `799.33`, not `799.34`. | One minute: $799.67 week / $1,599.67 period; two: $799.33 / $1,599.33 |
| G58 | Non-exempt salary $800/week: with `2399` valid unpaid minutes, deduction `800 x 2399/2400 = 799.666666... -> 799.67`, week `800 - 799.67 = 0.33`, period `800.33`. At five full unpaid days, `U = 5 x 480 = 2400`; deduction `min(800, 800 x 2400/2400) = 800`; week `800 - 800 = 0`; other week `800`. A `2401`-minute request would have raw deduction `800 x 2401/2400 = 800.333333...`, cap `800`, but is invalid leave and cannot produce an accepted total. | Below cap: $0.33 week / $800.33 period; at cap: $0.00 / $800.00; excess input: incomplete |
| G59 | Exempt $52,000/year: nine full unpaid days deduct `9 x (52000/260) = 1800`, giving `2000 - 1800 = 200`. At ten full approved unpaid days, `10 x 480 = 4800` leave minutes; five per week deduct `5 x (52000/260) = 1000` each; period `2000 - 1000 - 1000 = 0`, exactly the cap. An eleventh day would request `11 x 200 = 2200 > 2000` but is invalid for this ten-day roster. | Nine days: $200.00; ten: $0.00; eleventh-day input: incomplete |
| G60 | Same exempt salary, one approved `479`-minute unpaid partial day: `479 < 480`, eligible full-day deductions `0`; `2000 - 0 = 2000`. At `480`, one full-day deduction `52000/260 = 200`; `2000 - 200 = 1800`. | $2,000.00 partial day; $1,800.00 full day |
| G61 | Actual work `[09:00,12:00)` and `[11:00,14:00)` overlaps for `60` minutes. Naive sum `180 + 180 = 360` and union `300` are both forbidden pay shortcuts until records are corrected. Same blocking rule applies if these are overlapping schedules, or if the second interval is approved leave overlapping actual work. | Schedule conflict and incomplete pay; total/delta null |

### Correction workflow boundaries

| ID | Case and arithmetic/evidence | Expected result |
|---|---|---|
| G62 | **ASSUMPTION A06:** At $20/hour, same-day known paid work changes from `240` to `210` minutes: reduction `240 - 210 = 30`; base before `240/60 x 20 = 80`, after `210/60 x 20 = 70`, delta `70 - 80 = -10`. Manager attestation alone is insufficient even when both traces recompute. | Employee confirmation plus independent authorized approval required |
| G63 | **ASSUMPTIONS A06/A08:** Valid candidate on a closed period, or proposed/approved by the same human: amount correctness does not grant authorization. For an open eligible candidate, two unchanged $800 salary weeks still require recomputing `800 + 800 = 1600`, not only the edited week. Missing original time cannot generate a delta: `known_after - unknown_before` remains unknown. | Reject closed/self approval; always full-period verification |

### Independent verification record

All original examples have been recalculated from the stated inputs, including
G07's complete `800 + 16 + 84 + 22.50` sum and G10's intentional change from
$800.00 to $640.00 for its affected week. The new boundary examples supply their
arithmetic explicitly. The final review must check not just dollar sums but
whether meals, dates, source validity, rounding groups, and authorization make
each scenario admissible. These are policy examples, not evidence that a pay
engine has been implemented or tested.

An independent review calculator, separate from application code, passed **164
assertions covering all 63 example IDs**. It uses exact rational expressions,
Decimal ROUND_HALF_UP on final component lines, and timezone-database checks for
the DST and dated boundary examples. This verifies the listed arithmetic and
explicit boundary predicates; it does not certify future engine behavior,
authorization enforcement, or legal compliance.

## DF-011 - Sign-off and change control

The reviewed source, assumptions, and examples form the implementation baseline.
That source review does not activate a compiled ruleset: the application must
separately show source-to-rule mappings, version and content hashes, signer identity,
and explicit activation before verification or attendance commits are permitted.

Any later policy edit creates a new draft version and invalidates affected pending
verification. Never change an active signed version in place. Unsupported input
must produce an explicit manual-review result. Policy replay remains deferred.
