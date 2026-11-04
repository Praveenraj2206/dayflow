from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.data import generate
from app.domain import Employee, Employment, Interval, Leave, Schedule, Timecard, WorkShift
from app.engine import calculate

ZONE = ZoneInfo("America/New_York")
START = date(2026, 10, 5)


def instant(day=0, hour=7, minute=0, start=START):
    return datetime.combine(start + timedelta(days=day), time(hour, minute), ZONE)


def card(kind=Employment.hourly, rate="20", start=START, salary="800", annual="52000"):
    result = Timecard(
        id="golden", employee=Employee(
            id="golden", name="Golden Employee", title="Test", department="Test",
            employment=kind, hourly_rate=rate, weekly_salary=salary, annual_salary=annual,
        ), period_start=start, as_of=instant(14, 0, start=start),
    )
    if kind != Employment.hourly:
        for day in range(14):
            if day % 7 < 5:
                begin = instant(day, 9, start=start)
                br = Interval(start=begin + timedelta(hours=4),
                              end=begin + timedelta(hours=4, minutes=30))
                result.schedules.append(Schedule(
                    id=f"s{day}", start=begin, end=begin + timedelta(minutes=510),
                    planned_breaks=[br], absence_confirmed=True,
                ))
    return result


def work(result, day, worked_minutes, *, meals=True):
    begin = instant(day, start=result.period_start)
    breaks = []
    if meals and worked_minutes > 300:
        breaks.append(Interval(start=begin + timedelta(minutes=240),
                               end=begin + timedelta(minutes=270)))
    if meals and worked_minutes > 600:
        breaks.append(Interval(start=begin + timedelta(minutes=540),
                               end=begin + timedelta(minutes=570)))
    shift = WorkShift(id=f"s{day}", start=begin,
                      end=begin + timedelta(minutes=worked_minutes + 30 * len(breaks)),
                      breaks=breaks)
    result.shifts.append(shift)
    return shift


def component(pay, key, week=None):
    return sum((Decimal(line.amount) for line in pay.lines
                if line.component == key and (week is None or line.week == str(week))), Decimal(0))


@pytest.mark.parametrize("case,daily_minutes,expected,ot", [
    ("G01", [480] * 5, "800.00", 0),
    ("G02", [600], "220.00", 120),
    ("G03", [780], "320.00", 300),
    ("G04", [480] * 6, "1040.00", 480),
    ("G05", [600] * 5, "1100.00", 600),
    ("G06", [540] * 5 + [480], "1190.00", 780),
])
def test_overtime_goldens(case, daily_minutes, expected, ot):
    result = card()
    for day, duration in enumerate(daily_minutes):
        work(result, day, duration)
    pay = calculate(result)
    assert pay.total == expected, (case, pay.reasons)
    assert pay.overtime_minutes == ot


@pytest.mark.parametrize("worked,expected", [
    (479, "479.00"), (480, "480.00"), (481, "481.50"),
    (719, "838.50"), (720, "840.00"), (721, "842.00"),
])
def test_daily_boundaries_g25_g28(worked, expected):
    result = card(rate="60")
    work(result, 0, worked)
    assert calculate(result).total == expected


@pytest.mark.parametrize("extra,expected", [(0, "2400.00"), (1, "2401.50")])
def test_weekly_boundaries_g29_g30(extra, expected):
    result = card(rate="60")
    for day in range(5):
        work(result, day, 480)
    if extra:
        work(result, 5, extra)
    assert calculate(result).total == expected


def test_regular_rate_g07_and_g08():
    result = card()
    for day in range(2, 6):
        work(result, day, 480)
    # Eight actual night hours, and one missed-meal premium, at regular rate.
    result.shifts.append(WorkShift(id="s0", start=instant(0, 22), end=instant(1, 6), breaks=[]))
    result.bonuses = {str(START): Decimal("84")}
    pay = calculate(result)
    assert Decimal(pay.regular_rates[str(START)]) == Decimal("22.5")
    assert pay.total == "922.50"
    result = card()
    for day in range(6):
        begin = instant(day, 21, 30)
        result.shifts.append(WorkShift(
            id=f"s{day}", start=begin, end=instant(day + 1, 6),
            breaks=[Interval(start=begin, end=instant(day, 22))],
        ))
    pay = calculate(result)
    assert component(pay, "night") == Decimal("96.00")
    assert pay.total == "1144.00"
    assert pay.work_minutes == 2880
    assert sum(Decimal(line.amount) for line in pay.lines) == Decimal(pay.total)


@pytest.mark.parametrize("daily,unpaid,expected", [
    ([480] * 6, 0, "1840.00"),  # G09
    ([480] * 4, 480, "1440.00"),  # G10
    ([600, 480, 480, 360], 0, "1620.00"),  # G23
    ([600, 480, 480, 360], 480, "1460.00"),  # G24
])
def test_salaried_non_exempt(daily, unpaid, expected):
    result = card(Employment.salaried_non_exempt)
    for day, duration in enumerate(daily):
        work(result, day, duration)
    if unpaid:
        day = 4
        begin = instant(day, 9)
        result.leave = [
            Leave(id="leave-a", kind="unpaid", start=begin, end=begin + timedelta(hours=4)),
            Leave(id="leave-b", kind="unpaid", start=begin + timedelta(hours=4, minutes=30),
                  end=begin + timedelta(hours=8, minutes=30)),
        ]
    pay = calculate(result)
    assert pay.total == expected, pay.reasons
    assert Decimal(pay.regular_rates[str(START)]) == 20


@pytest.mark.parametrize("minutes_leave,expected", [(1, "1599.67"), (2, "1599.33"), (240, "1520.00")])
def test_unpaid_rounding_g57(minutes_leave, expected):
    result = card(Employment.salaried_non_exempt)
    result.leave = [Leave(id="leave", kind="unpaid", start=instant(0, 9),
                          end=instant(0, 9) + timedelta(minutes=minutes_leave))]
    assert calculate(result).total == expected


def test_exempt_rounding_and_partial_day_g11_g21_g60():
    result = card(Employment.salaried_exempt, annual="52000.26")
    assert calculate(result).total == "2000.02"
    result.employee.annual_salary = "52000"
    result.leave = [Leave(id="partial", kind="unpaid", start=instant(0, 9), end=instant(0, 12))]
    assert calculate(result).total == "2000.00"
    result.leave = [
        Leave(id="a", kind="unpaid", start=instant(0, 9), end=instant(0, 13)),
        Leave(id="b", kind="unpaid", start=instant(0, 13, 30), end=instant(0, 17, 30)),
    ]
    assert calculate(result).total == "1800.00"
    result.employee.employment = Employment.hourly
    result.leave[0].kind = result.leave[1].kind = "paid"
    assert calculate(result).total == "160.00"


@pytest.mark.parametrize("same_week,expected", [(True, "0.67"), (False, "0.66")])
def test_component_aggregation_g16_g20_g21(same_week, expected):
    result = card()
    work(result, 0, 1)
    work(result, 1 if same_week else 7, 1)
    assert calculate(result).total == expected


@pytest.mark.parametrize("start,end,period,expected,minutes", [
    ("2026-03-08T01:30:00-05:00", "2026-03-08T03:30:00-04:00",
     date(2026, 3, 2), "22.00", 60),
    ("2026-11-01T00:30:00-04:00", "2026-11-01T02:30:00-05:00",
     date(2026, 10, 26), "66.00", 180),
])
def test_dst_g17_g18(start, end, period, expected, minutes):
    result = card(start=period)
    result.shifts = [WorkShift(id="dst", start=start, end=end)]
    pay = calculate(result)
    assert pay.total == expected
    assert pay.work_minutes == minutes


def test_missing_invalid_and_overlap_fail_closed_g19():
    result = card()
    shift = work(result, 0, 480)
    shift.end = None
    assert calculate(result).total is None
    shift.end = shift.start
    assert calculate(result).total is None
    shift.end = shift.start + timedelta(hours=1)
    result.shifts.append(shift.model_copy())
    pay = calculate(result)
    assert pay.total is None
    assert any(e.family == "schedule_conflict" for e in pay.exceptions)


def test_overnight_local_day_split_g22():
    result = card(start=date(2026, 11, 9))
    result.shifts = [WorkShift(
        id="overnight", start="2026-11-09T22:00:00-05:00", end="2026-11-10T08:00:00-05:00",
        breaks=[Interval(start="2026-11-10T02:00:00-05:00", end="2026-11-10T02:30:00-05:00")],
    )]
    pay = calculate(result)
    assert pay.total == "205.00"
    assert pay.work_minutes == 570 and pay.night_minutes == 450
    assert pay.overtime_minutes == 0


@pytest.mark.parametrize("worked,first_waiver,expected", [
    (299, False, "299.00"), (300, False, "300.00"), (301, False, "361.00"),
    (359, True, "359.00"), (360, True, "360.00"), (360, False, "420.00"),
    (361, True, "421.00"),
])
def test_first_meal_boundary_g31_g32_g36_g37(worked, first_waiver, expected):
    result = card(rate="60")
    shift = work(result, 0, worked, meals=False)
    shift.first_waiver = first_waiver
    assert calculate(result).total == expected


@pytest.mark.parametrize("start,length,expected", [
    (300, 30, "330.00"), (300, 31, "330.00"),
    (301, 30, "390.00"), (240, 29, "390.00"),
])
def test_meal_deadline_and_length_g33_g35(start, length, expected):
    result = card(rate="60")
    shift = work(result, 0, 330, meals=False)
    shift.end += timedelta(minutes=length)
    shift.breaks = [Interval(start=shift.start + timedelta(minutes=start),
                             end=shift.start + timedelta(minutes=start + length))]
    assert calculate(result).total == expected


@pytest.mark.parametrize("worked,second_waiver,expected", [
    (599, False, "658.50"), (600, False, "660.00"), (601, False, "721.50"),
    (719, True, "838.50"), (720, True, "840.00"), (720, False, "900.00"),
    (721, True, "902.00"),
])
def test_second_meal_and_waiver_g38_g42(worked, second_waiver, expected):
    result = card(rate="60")
    shift = work(result, 0, worked, meals=False)
    shift.end += timedelta(minutes=30)
    shift.breaks = [Interval(start=shift.start + timedelta(minutes=240),
                             end=shift.start + timedelta(minutes=270))]
    shift.second_waiver = second_waiver
    assert calculate(result).total == expected


@pytest.mark.parametrize("second_start,expected", [(600, "750.00"), (601, "810.00")])
def test_second_deadline_g40(second_start, expected):
    result = card(rate="60")
    shift = work(result, 0, 660, meals=False)
    shift.end += timedelta(minutes=60)
    shift.breaks = [
        Interval(start=shift.start + timedelta(minutes=240), end=shift.start + timedelta(minutes=270)),
        Interval(start=shift.start + timedelta(minutes=second_start),
                 end=shift.start + timedelta(minutes=second_start + 30)),
    ]
    assert calculate(result).total == expected


@pytest.mark.parametrize("hour,minute,expected", [
    (21, 59, "1.00"), (22, 0, "1.03"), (5, 59, "1.03"), (6, 0, "1.00"),
])
def test_night_endpoints_g44_g47(hour, minute, expected):
    result = card(rate="60")
    begin = instant(0, hour, minute)
    result.shifts = [WorkShift(id="night", start=begin, end=begin + timedelta(minutes=1))]
    assert calculate(result).total == expected


@pytest.mark.parametrize("variance,conflict", [(14, False), (15, False), (16, True)])
def test_schedule_tolerance_g48_g49(variance, conflict):
    result = card()
    shift = work(result, 0, 480)
    result.schedules = [Schedule(
        id=shift.id, start=shift.start - timedelta(minutes=variance),
        end=shift.end - timedelta(minutes=variance), planned_unpaid_break_minutes=30,
    )]
    assert any(e.code == "variance" for e in calculate(result).exceptions) == conflict


def test_future_forecast_subtracts_breaks_g51():
    result = card()
    result.as_of = instant(0, 0)
    for day in range(5):
        result.schedules.append(Schedule(id=f"s{day}", start=instant(day, 9),
                                        end=instant(day, 17, 30)))
    pay = calculate(result)
    assert pay.projected_minutes[str(START)] == 2400
    assert not any(e.family == "overtime_risk" for e in pay.exceptions)
    assert pay.total is None  # unknown future work never becomes payable zero
    result.schedules[-1].end += timedelta(minutes=1)
    pay = calculate(result)
    assert pay.projected_minutes[str(START)] == 2401
    assert any(e.family == "overtime_risk" for e in pay.exceptions)


@pytest.mark.parametrize("opening,credit,complete", [(4799, 1, True), (4800, 1, False)])
def test_comp_cap_g53_g54(opening, credit, complete):
    result = card(Employment.salaried_exempt)
    result.opening_comp_minutes = opening
    shift = work(result, 5, credit)
    shift.work_approved = True
    pay = calculate(result)
    assert (pay.total is not None) == complete
    if complete:
        assert pay.closing_comp_minutes == 4800


@pytest.mark.parametrize("opening,complete", [(30, True), (29, False)])
def test_comp_debit_g55(opening, complete):
    result = card(Employment.salaried_exempt)
    result.opening_comp_minutes = opening
    result.leave = [Leave(id="comp", kind="comp_off", start=instant(0, 9), end=instant(0, 9, 30))]
    pay = calculate(result)
    assert (pay.total is not None) == complete
    if complete:
        assert pay.closing_comp_minutes == 0


def test_comp_tie_debit_before_credit_g56():
    result = card(Employment.salaried_exempt)
    result.schedules[0] = Schedule(
        id="s0", start=instant(0, 0), end=instant(0, 8, 30),
        planned_breaks=[Interval(start=instant(0, 4), end=instant(0, 4, 30))],
        absence_confirmed=True,
    )
    result.shifts = [WorkShift(id="weekend", start=instant(-1, 23, 30),
                              end=instant(0, 0), work_approved=True)]
    result.leave = [Leave(id="comp", kind="comp_off", start=instant(0, 0), end=instant(0, 0, 30))]
    assert calculate(result).total is None
    result.opening_comp_minutes = 30
    assert calculate(result).closing_comp_minutes == 30


@pytest.mark.parametrize("duration,violation", [(960, False), (961, True)])
def test_long_shift_remains_payable(duration, violation):
    result = card()
    work(result, 0, duration)
    pay = calculate(result)
    assert pay.total is not None
    assert any(e.code == "long_shift" for e in pay.exceptions) == violation


def test_unsupported_and_invalid_inputs():
    result = card()
    result.bonuses = {"2027-01-04": Decimal("12")}
    assert calculate(result).total is None
    result.bonuses = {}
    result.opening_comp_minutes = 1
    assert calculate(result).total is None
    result = card(Employment.salaried_non_exempt)
    result.schedules.pop()
    assert calculate(result).total is None
    result = card()
    result.shifts = [WorkShift(id="bad-offset", start="2026-10-05T09:00:00-08:00",
                              end="2026-10-05T10:00:00-08:00")]
    assert calculate(result).total is None
    with pytest.raises(ValidationError):
        WorkShift(id="naive", start="2026-10-05T09:00:00", end=None)
    with pytest.raises(ValidationError):
        WorkShift(id="seconds", start="2026-10-05T09:00:01-04:00", end=None)


def test_meal_premium_cap_g43():
    result = card(rate="60")
    work(result, 0, 780, meals=False)
    pay = calculate(result)
    assert pay.total == "1020.00"
    assert component(pay, "meal") == 60


@pytest.mark.parametrize("prior_work,expected", [(False, "22.00"), (True, "827.01")])
def test_week_boundary_g50(prior_work, expected):
    result = card(start=date(2026, 11, 2))
    if prior_work:
        for day in range(5):
            work(result, day, 480)
    result.shifts.append(WorkShift(id="boundary", start="2026-11-08T23:30:00-05:00",
                                  end="2026-11-09T00:30:00-05:00"))
    pay = calculate(result)
    assert pay.total == expected
    assert component(pay, "weekly_ot", date(2026, 11, 9)) == 0


@pytest.mark.parametrize("leave_minutes,missed", [(0, True), (240, True), (480, False)])
def test_missed_shift_leave_coverage_g52(leave_minutes, missed):
    result = card()
    result.schedules = [Schedule(id="scheduled", start=instant(0, 9), end=instant(0, 17),
                                 planned_unpaid_break_minutes=0)]
    if leave_minutes:
        result.leave = [Leave(id="paid", kind="paid", start=instant(0, 9),
                              end=instant(0, 9) + timedelta(minutes=leave_minutes))]
    pay = calculate(result)
    assert any(e.code == "missed_shift" for e in pay.exceptions) == missed
    assert (pay.total is None) == missed


@pytest.mark.parametrize("kind,days,expected", [
    (Employment.salaried_non_exempt, 5, "800.00"),
    (Employment.salaried_exempt, 9, "200.00"),
    (Employment.salaried_exempt, 10, "0.00"),
])
def test_full_leave_deduction_caps_g58_g59(kind, days, expected):
    result = card(kind)
    for schedule in result.schedules[:days]:
        begin = schedule.start
        result.leave.extend([
            Leave(id=f"{schedule.id}-a", kind="unpaid", start=begin, end=begin + timedelta(hours=4)),
            Leave(id=f"{schedule.id}-b", kind="unpaid", start=begin + timedelta(hours=4, minutes=30),
                  end=schedule.end),
        ])
    assert calculate(result).total == expected


def test_overlaps_across_source_classes_g61():
    result = card()
    begin = instant(0, 9)
    result.shifts = [
        WorkShift(id="first", start=begin, end=begin + timedelta(hours=3)),
        WorkShift(id="second", start=begin + timedelta(hours=2), end=begin + timedelta(hours=5)),
    ]
    pay = calculate(result)
    assert pay.total is None and any(e.code == "actual_overlap" for e in pay.exceptions)
    result.shifts.pop()
    result.schedules = [Schedule(id="first", start=begin, end=begin + timedelta(hours=5),
                                 planned_unpaid_break_minutes=0)]
    result.leave = [Leave(id="leave", kind="paid", start=begin + timedelta(hours=2),
                          end=begin + timedelta(hours=5))]
    pay = calculate(result)
    assert pay.total is None and any(e.code == "work_leave_overlap" for e in pay.exceptions)


@pytest.mark.parametrize("seed", [42, 104729])
def test_independent_synthetic_labels(seed):
    cards, labels, fixes = generate(seed)
    assert len(cards) == 60 and len(fixes) == 10
    assert 148 <= sum(map(len, labels.values())) <= 160
    for result in cards:
        assert {e.id for e in calculate(result).exceptions} == labels[result.id], result.id
