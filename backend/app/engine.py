from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from zoneinfo import ZoneInfo

from .domain import (
    Employment, ExceptionItem, PayResult, Rules, Timecard, TraceLine, minutes, utc,
)

D = Decimal
CENT = D("0.01")
MINUTE = timedelta(minutes=1)
LABELS = {
    "hourly_base": ("Worked time", "DF-002"),
    "salary": ("Guaranteed salary", "DF-002"),
    "extra_base": ("Additional straight time", "DF-002"),
    "night": ("Night differential", "DF-003"),
    "bonus": ("Weekly bonus", "DF-003"),
    "daily_ot": ("Daily overtime premium", "DF-004"),
    "weekly_ot": ("Weekly overtime premium", "DF-004"),
    "double_time": ("Double-time premium", "DF-004"),
    "paid_leave": ("Paid leave", "DF-007"),
    "unpaid_leave": ("Approved unpaid-leave deduction", "DF-007"),
    "meal": ("Meal premium", "DF-005"),
}


def money(value: Decimal) -> str:
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def week_of(day):
    return day - timedelta(days=day.weekday())


def minute_instants(start, end):
    cursor, stop = utc(start), utc(end)
    while cursor < stop:
        yield cursor
        cursor += MINUTE


def overlaps(a, b) -> bool:
    return utc(a.start) < utc(b.end) and utc(b.start) < utc(a.end)


def _calculate(card: Timecard, rules: Rules, version: str) -> PayResult:
    zone = ZoneInfo(card.employee.timezone)
    exempt = card.employee.employment == Employment.salaried_exempt
    salary_ne = card.employee.employment == Employment.salaried_non_exempt
    weeks = [card.period_start, card.period_start + timedelta(days=7)]
    exceptions: dict[str, ExceptionItem] = {}
    reasons: list[str] = []
    daily = defaultdict(int)
    night = defaultdict(int)
    weekly = defaultdict(int)
    day_sources = defaultdict(set)
    meal_dates = set()
    comp_events = []
    valid_shifts = []
    shift_work = {}
    projected = defaultdict(int)
    forecast_unknown = set()
    approved_leave = [item for item in card.leave if item.approved]
    leave_instants = set()
    leave_by_day = defaultdict(lambda: defaultdict(int))

    def issue(family, code, reference, title, clause, blocking=False, facts=None):
        key = f"{family}:{code}:{reference}"
        exceptions[key] = ExceptionItem(
            id=key, family=family, code=code, reference=reference, title=title,
            clause=clause, blocking=blocking,
            severity="critical" if blocking else "warning",
            facts=facts or {},
        )
        if blocking:
            reasons.append(title)
            forecast_unknown.update(weeks)

    def in_period(instant):
        return card.period_start <= instant.astimezone(zone).date() < card.period_end

    def valid_interval(record, ref):
        if minutes(record.start, record.end) <= 0:
            issue("policy_breach", "invalid_interval", ref, "Nonpositive interval", "DF-001", True)
            return False
        for value in (record.start, record.end):
            if value.utcoffset() != timedelta(0) and (
                value.astimezone(zone).utcoffset() != value.utcoffset()
            ):
                issue("policy_breach", "invalid_offset", ref, "Invalid local timestamp offset",
                      "DF-001", True)
                return False
        if minutes(record.start, record.end) > 60 * 48:
            issue("policy_breach", "invalid_interval", ref, "Interval exceeds supported duration",
                  "DF-001", True)
            return False
        return True

    def check_overlaps(records, code):
        for index, first in enumerate(records):
            for second in records[index + 1:]:
                if overlaps(first, second):
                    ref = ":".join(sorted([first.id, second.id]))
                    issue("schedule_conflict", code, ref, "Overlapping source intervals",
                          "DF-006", True)

    valid_schedules = [s for s in card.schedules if valid_interval(s, s.id)]
    if set(card.bonuses) - {str(w) for w in weeks}:
        issue("policy_breach", "bonus_week", card.id, "Bonus references an unsupported workweek",
              "DF-003", True)
    if not exempt and card.opening_comp_minutes:
        issue("policy_breach", "comp_classification", card.id,
              "Non-exempt comp-off bank is unsupported", "DF-008", True)
    if exempt or salary_ne:
        for week in weeks:
            roster = [s for s in valid_schedules
                      if week <= s.start.astimezone(zone).date() < week + timedelta(days=7)]
            expected_days = {week + timedelta(days=i) for i in range(5)}
            if (
                len(roster) != 5
                or {s.start.astimezone(zone).date() for s in roster} != expected_days
                or any(
                    s.start.astimezone(zone).date() != (utc(s.end) - MINUTE).astimezone(zone).date()
                    or minutes(s.start, s.end) - s.planned_unpaid_break_minutes != 480
                    for s in roster
                )
            ):
                issue("policy_breach", "salary_roster", str(week),
                      "Unsupported salaried roster; five weekday eight-hour days required",
                      "DF-007", True)
    check_overlaps(valid_schedules, "schedule_overlap")
    valid_leaves = [item for item in approved_leave if valid_interval(item, item.id)]
    check_overlaps(valid_leaves, "leave_overlap")
    schedule_work = {}
    for schedule in valid_schedules:
        if schedule.planned_unpaid_break_minutes >= minutes(schedule.start, schedule.end):
            issue("policy_breach", "planned_break", schedule.id, "Invalid planned break total",
                  "DF-006", True)
        planned = set()
        for br in schedule.planned_breaks:
            if not valid_interval(br, schedule.id) or (
                utc(br.start) < utc(schedule.start) or utc(br.end) > utc(schedule.end)
            ):
                issue("policy_breach", "planned_break", schedule.id, "Invalid planned break interval",
                      "DF-006", True)
                continue
            current = set(minute_instants(br.start, br.end))
            if planned & current:
                issue("schedule_conflict", "planned_break_overlap", schedule.id,
                      "Overlapping planned breaks", "DF-006", True)
            planned |= current
        if schedule.planned_breaks and len(planned) != schedule.planned_unpaid_break_minutes:
            issue("policy_breach", "planned_break", schedule.id, "Planned break minutes disagree",
                  "DF-006", True)
        schedule_work[schedule.id] = set(minute_instants(schedule.start, schedule.end)) - planned
        if schedule.absence_confirmed:
            issue("policy_breach", "absence", schedule.id, "Confirmed unapproved absence",
                  "DF-007")

    for leave in valid_leaves:
        instants = list(minute_instants(leave.start, leave.end))
        covered = set().union(*schedule_work.values()) if schedule_work else set()
        if any(instant not in covered for instant in instants):
            issue("policy_breach", "leave_schedule", leave.id, "Leave is outside scheduled work",
                  "DF-007", True)
        for instant in instants:
            if in_period(instant):
                leave_instants.add(instant)
                leave_by_day[instant.astimezone(zone).date()][leave.kind] += 1
        if leave.kind == "comp_off":
            if not exempt:
                issue("policy_breach", "comp_classification", leave.id,
                      "Comp-off is supported only for exempt employees", "DF-008", True)
            comp_events.append({
                "at": utc(leave.start).isoformat(), "minutes": -len(instants),
                "source": leave.id, "kind": "leave_debit",
            })
    for day, kinds in leave_by_day.items():
        if sum(kinds.values()) > 480:
            issue("policy_breach", "leave_limit", day.isoformat(),
                  "Approved leave exceeds the daily limit", "DF-007", True)

    seen = set()
    for shift in card.shifts:
        if shift.id in seen:
            issue("missed_punch", "duplicate", shift.id, "Duplicate punch event", "DF-001", True)
        seen.add(shift.id)
        if shift.start is None or shift.end is None:
            issue("missed_punch", "missing_endpoint", shift.id, "Missing clock-in or clock-out",
                  "DF-006", True)
            known = shift.start or shift.end
            if known:
                forecast_unknown.add(week_of(known.astimezone(zone).date()))
            else:
                forecast_unknown.update(weeks)
            continue
        if not valid_interval(shift, shift.id):
            continue
        if utc(shift.end) > utc(card.as_of):
            reasons.append("Actual work extends beyond the calculation snapshot")
        broken = set()
        for br in shift.breaks:
            if not valid_interval(br, shift.id) or (
                utc(br.start) < utc(shift.start) or utc(br.end) > utc(shift.end)
            ):
                issue("policy_breach", "break_bounds", shift.id, "Break is outside its shift",
                      "DF-001", True)
                continue
            instants = set(minute_instants(br.start, br.end))
            if broken & instants:
                issue("schedule_conflict", "break_overlap", shift.id, "Overlapping unpaid breaks",
                      "DF-001", True)
            broken |= instants
        worked = [i for i in minute_instants(shift.start, shift.end) if i not in broken]
        shift_work[shift.id] = worked
        valid_shifts.append(shift)
        for instant in worked:
            if instant in leave_instants:
                issue("schedule_conflict", "work_leave_overlap", shift.id,
                      "Actual work overlaps approved leave", "DF-006", True)
            if not in_period(instant):
                continue
            local = instant.astimezone(zone)
            day, week = local.date(), week_of(local.date())
            daily[day] += 1
            weekly[week] += 1
            day_sources[day].add(shift.id)
            if local.hour >= 22 or local.hour < 6:
                night[week] += 1
        if len(worked) > rules.long_shift_minutes:
            issue("policy_breach", "long_shift", shift.id, "Long shift requires acknowledgment",
                  "DF-006", facts={"worked_minutes": len(worked)})
        if not exempt:
            eligible = sorted(
                [b for b in shift.breaks if minutes(b.start, b.end) >= rules.meal_length],
                key=lambda b: utc(b.start),
            )
            first = next((b for b in eligible if minutes(shift.start, b.start)
                          <= rules.first_meal_minutes), None)
            second = next((b for b in eligible if first and utc(b.start) >= utc(first.end)
                           and minutes(shift.start, b.start) <= rules.second_meal_minutes), None)
            first_ok = first is not None or (
                shift.first_waiver and len(worked) <= rules.first_waiver_limit
            )
            second_ok = second is not None or (
                shift.second_waiver and first is not None
                and len(worked) <= rules.second_waiver_limit
            )
            if ((len(worked) > rules.first_meal_minutes and not first_ok)
                    or (len(worked) > rules.second_meal_minutes and not second_ok)):
                day = shift.start.astimezone(zone).date()
                if card.period_start <= day < card.period_end:
                    meal_dates.add(day)
                    issue("policy_breach", "meal", shift.id, "Meal premium is payable",
                          "DF-005", facts={"shift_start_date": str(day)})
        if exempt and shift.work_approved:
            by_day = defaultdict(list)
            for instant in worked:
                by_day[instant.astimezone(zone).date()].append(instant)
            for day, instants in by_day.items():
                scheduled = any(
                    instant in schedule_work[s.id]
                    for s in valid_schedules for instant in instants
                )
                if day.weekday() >= 5 and not scheduled:
                    comp_events.append({
                        "at": (instants[-1] + MINUTE).isoformat(), "minutes": len(instants),
                        "source": f"{shift.id}:{day}", "kind": "work_credit",
                    })

    check_overlaps(valid_shifts, "actual_overlap")
    schedules_by_id = {s.id: s for s in valid_schedules}
    for shift in valid_shifts:
        schedule = schedules_by_id.get(shift.id)
        if schedule is None:
            issue("schedule_conflict", "unscheduled", shift.id, "Unscheduled work recorded",
                  "DF-006")
        elif max(abs(minutes(schedule.start, shift.start)), abs(minutes(schedule.end, shift.end))) \
                > rules.tolerance_minutes:
            issue("schedule_conflict", "variance", shift.id, "Punch differs from schedule",
                  "DF-006", facts={
                      "start_variance_minutes": minutes(schedule.start, shift.start),
                      "end_variance_minutes": minutes(schedule.end, shift.end),
                  })

    shifts_by_id = {s.id: s for s in card.shifts}
    for schedule in valid_schedules:
        work = schedule_work[schedule.id]
        full_leave = bool(work) and work <= leave_instants
        if not shifts_by_id.get(schedule.id) and not schedule.absence_confirmed and not full_leave:
            if utc(schedule.end) <= utc(card.as_of):
                issue("missed_punch", "missed_shift", schedule.id, "Scheduled shift has no punches",
                      "DF-006", True)
            else:
                reasons.append("Pay period contains future work not yet recorded")
        if exempt:
            continue
        week = week_of(schedule.start.astimezone(zone).date())
        actual = shifts_by_id.get(schedule.id)
        if utc(schedule.start) < utc(card.as_of) < utc(schedule.end):
            forecast_unknown.add(week)
        elif utc(schedule.start) >= utc(card.as_of) and not schedule.absence_confirmed:
            multi_day = schedule.start.astimezone(zone).date() != (
                utc(schedule.end) - MINUTE
            ).astimezone(zone).date()
            partial_leave = bool(work & leave_instants) and not full_leave
            if (multi_day or partial_leave) and not schedule.planned_breaks:
                forecast_unknown.add(week)
            elif schedule.planned_breaks:
                for instant in work - leave_instants:
                    local = instant.astimezone(zone)
                    projected[local.date()] += 1
            elif not full_leave:
                projected[schedule.start.astimezone(zone).date()] += (
                    minutes(schedule.start, schedule.end) - schedule.planned_unpaid_break_minutes
                )
        elif actual and actual.id not in shift_work:
            forecast_unknown.add(week)

    if not exempt:
        for shift in valid_shifts:
            if utc(shift.end) <= utc(card.as_of):
                for instant in shift_work[shift.id]:
                    if in_period(instant):
                        projected[instant.astimezone(zone).date()] += 1
        for week in weeks:
            days = [week + timedelta(days=i) for i in range(7)]
            forecast = sum(projected[day] for day in days)
            if week not in forecast_unknown and (
                forecast > rules.weekly_minutes
                or any(projected[day] > rules.daily_minutes for day in days)
            ):
                issue("overtime_risk", "forecast", str(week), "Overtime exposure detected",
                      "DF-004", facts={
                          "projected_minutes": forecast,
                          "daily_threshold": rules.daily_minutes,
                          "weekly_threshold": rules.weekly_minutes,
                      })

    lines = []
    regular_rates = {}
    overtime_total = 0

    def line(week, component, quantity, unit, rate, raw, formula, sources=None, suffix=""):
        if raw == 0:
            return
        label, clause = LABELS[component]
        lines.append(TraceLine(
            id=f"{week}:{component}{suffix}", week=str(week), component=component,
            label=label, quantity=str(quantity), unit=unit,
            rate=str(rate), unrounded=str(raw), amount=money(raw), formula=formula,
            clause=clause, sources=sorted(sources or []),
        ))

    for week in weeks:
        days = [week + timedelta(days=i) for i in range(7)]
        work = weekly[week]
        hours = D(work) / 60
        source_ids = set().union(*(day_sources[d] for d in days))
        leave_paid = sum(leave_by_day[d]["paid"] for d in days)
        leave_unpaid = sum(leave_by_day[d]["unpaid"] for d in days)
        if exempt:
            base = card.employee.annual_salary / 52
            full_days = sum(leave_by_day[d]["unpaid"] == 480 for d in days)
            if full_days > 5:
                issue("policy_breach", "deduction_limit", str(week),
                      "Too many exempt deduction days", "DF-007", True)
            deduction = min(base, D(full_days) * card.employee.annual_salary / 260)
            line(week, "salary", 1, "week", base, base, "annual salary / 52")
            line(week, "unpaid_leave", full_days, "day", card.employee.annual_salary / 260,
                 -deduction, "-min(weekly salary, full unpaid days x annual salary / 260)")
            if card.bonuses.get(str(week), 0):
                issue("policy_breach", "exempt_bonus", str(week),
                      "Exempt bonus is outside this mock policy", "DF-002", True)
            continue
        base_rate = card.employee.weekly_salary / 40 if salary_ne else card.employee.hourly_rate
        differential = D(night[week]) / 60 * rules.night_differential
        bonus = card.bonuses.get(str(week), D(0))
        if not work and bonus:
            issue("policy_breach", "bonus_without_work", str(week),
                  "Positive bonus has no worked-hour allocation", "DF-003", True)
        rr = base_rate + (differential + bonus) / hours if work else base_rate
        regular_rates[str(week)] = str(rr)
        daily_ot = sum(min(max(daily[d] - rules.daily_minutes, 0),
                           rules.double_minutes - rules.daily_minutes) for d in days)
        double = sum(max(daily[d] - rules.double_minutes, 0) for d in days)
        straight_pool = sum(min(daily[d], rules.daily_minutes) for d in days)
        weekly_ot = max(straight_pool - rules.weekly_minutes, 0)
        overtime_total += daily_ot + weekly_ot + double
        if salary_ne:
            salary = card.employee.weekly_salary
            line(week, "salary", 1, "week", salary, salary, "weekly salary")
            extra = max(hours - 40, D(0))
            line(week, "extra_base", extra, "hour", base_rate, extra * base_rate,
                 "max(worked hours - 40, 0) x converted base rate", source_ids)
            if leave_unpaid > 2400:
                issue("policy_breach", "deduction_limit", str(week),
                      "Unpaid leave exceeds the supported weekly roster", "DF-007", True)
            deduction = min(salary, salary * leave_unpaid / 2400)
            line(week, "unpaid_leave", leave_unpaid, "minute", salary / 2400,
                 -deduction, "-min(salary, salary x approved unpaid minutes / 2400)")
        else:
            line(week, "hourly_base", hours, "hour", base_rate, hours * base_rate,
                 "worked minutes / 60 x hourly rate", source_ids)
            line(week, "paid_leave", D(leave_paid) / 60, "hour", base_rate,
                 D(leave_paid) / 60 * base_rate, "paid leave minutes / 60 x base rate")
        line(week, "night", D(night[week]) / 60, "hour", rules.night_differential,
             differential, "night minutes / 60 x night differential", source_ids)
        line(week, "bonus", 1, "week", bonus, bonus, "approved weekly bonus")
        for component, count, multiplier in (
            ("daily_ot", daily_ot, D("0.5")), ("weekly_ot", weekly_ot, D("0.5")),
            ("double_time", double, D(1)),
        ):
            line(week, component, D(count) / 60, "hour", rr * multiplier,
                 D(count) / 60 * rr * multiplier,
                 f"{component} minutes / 60 x regular rate x {multiplier}", source_ids)
        for day in sorted(d for d in meal_dates if week_of(d) == week):
            line(week, "meal", 1, "premium", rr, rr,
                 "one hour x weekly regular rate; capped per shift-start date",
                 suffix=f":{day}")

    balance = card.opening_comp_minutes
    if balance > rules.comp_cap:
        issue("policy_breach", "comp_opening", card.id, "Opening comp-off exceeds cap", "DF-008", True)
    for event in sorted(comp_events, key=lambda e: (e["at"], e["minutes"] > 0, e["source"])):
        if not in_period(datetime.fromisoformat(event["at"])):
            continue
        balance += event["minutes"]
        event["balance"] = balance
        if balance < 0 or balance > rules.comp_cap:
            issue("policy_breach", "comp_balance", event["source"],
                  "Comp-off event violates the bank limit", "DF-008", True)
    complete = not reasons
    return PayResult(
        status="complete" if complete else "incomplete",
        total=money(sum((D(item.amount) for item in lines), D(0))) if complete else None,
        lines=lines, exceptions=sorted(exceptions.values(), key=lambda e: (not e.blocking, e.id)),
        regular_rates=regular_rates, work_minutes=sum(weekly.values()),
        night_minutes=sum(night.values()) if not exempt else 0, overtime_minutes=overtime_total,
        projected_minutes={
            str(w): None if w in forecast_unknown else sum(
                projected[w + timedelta(days=i)] for i in range(7)
            ) for w in weeks
        } if not exempt else {},
        comp_events=[event for event in comp_events if "balance" in event],
        closing_comp_minutes=balance if complete else None,
        reasons=list(dict.fromkeys(reasons)), policy_version=version,
    )


def calculate(card: Timecard, rules: Rules | None = None, version="dayflow-usd-v1") -> PayResult:
    with localcontext() as context:
        context.prec = 40
        return _calculate(card, rules or Rules(), version)
