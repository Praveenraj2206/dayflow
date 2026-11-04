from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

DISCLAIMER = "simplified mock policy, not legal advice"
Money = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=6)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


def canonical(value: BaseModel | dict | list) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def fingerprint(value: BaseModel | dict | list) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def minutes(start: datetime, end: datetime) -> int:
    return int((utc(end) - utc(start)).total_seconds() // 60)


def aware(value: datetime | None) -> datetime | None:
    if value is not None and (
        value.tzinfo is None or value.utcoffset() is None or value.second or value.microsecond
    ):
        raise ValueError("Timestamps must be timezone-aware and precise to a whole minute")
    return value


class Employment(str, Enum):
    hourly = "hourly"
    salaried_non_exempt = "salaried_non_exempt"
    salaried_exempt = "salaried_exempt"


class Employee(Model):
    id: str
    name: str
    title: str
    department: str
    employment: Employment
    timezone: str = "America/New_York"
    hourly_rate: Money = Decimal("24")
    weekly_salary: Money = Decimal("960")
    annual_salary: Money = Decimal("62400")

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown IANA payroll timezone") from exc
        return value

    @model_validator(mode="after")
    def positive_compensation(self) -> Employee:
        if min(self.hourly_rate, self.weekly_salary, self.annual_salary) <= 0:
            raise ValueError("Compensation must be positive")
        return self


class Interval(Model):
    start: datetime
    end: datetime
    _aware = field_validator("start", "end")(aware)


class WorkShift(Model):
    id: str
    start: datetime | None
    end: datetime | None
    breaks: list[Interval] = Field(default_factory=list, max_length=12)
    first_waiver: bool = False
    second_waiver: bool = False
    work_approved: bool = False
    _aware = field_validator("start", "end")(aware)


class Schedule(Interval):
    id: str
    planned_unpaid_break_minutes: int = Field(default=30, ge=0, le=1440)
    planned_breaks: list[Interval] = Field(default_factory=list, max_length=12)
    absence_confirmed: bool = False


class Leave(Interval):
    id: str
    kind: Literal["paid", "unpaid", "comp_off"]
    approved: bool = True


class Timecard(Model):
    id: str
    employee: Employee
    period_start: date
    revision: int = Field(default=1, ge=1)
    period_status: Literal["open", "closed"] = "open"
    shifts: list[WorkShift] = Field(default_factory=list, max_length=100)
    schedules: list[Schedule] = Field(default_factory=list, max_length=100)
    leave: list[Leave] = Field(default_factory=list, max_length=100)
    bonuses: dict[str, Money] = Field(default_factory=dict)
    opening_comp_minutes: int = Field(default=0, ge=0, le=4800)
    note: str = Field(default="", max_length=4000)
    as_of: datetime
    _aware = field_validator("as_of")(aware)

    @field_validator("period_start")
    @classmethod
    def monday(cls, value: date) -> date:
        if value.weekday() != 0:
            raise ValueError("Pay period must start on Monday")
        return value

    @property
    def period_end(self) -> date:
        return self.period_start + timedelta(days=14)


class Rules(Model):
    daily_minutes: int = Field(default=480, ge=60, le=720)
    double_minutes: int = Field(default=720, ge=120, le=1440)
    weekly_minutes: int = Field(default=2400, ge=300, le=4800)
    night_differential: Money = Decimal("2")
    first_meal_minutes: int = Field(default=300, ge=60, le=600)
    second_meal_minutes: int = Field(default=600, ge=120, le=1200)
    meal_length: int = Field(default=30, ge=15, le=120)
    first_waiver_limit: int = Field(default=360, ge=60, le=720)
    second_waiver_limit: int = Field(default=720, ge=120, le=1440)
    tolerance_minutes: int = Field(default=15, ge=0, le=60)
    long_shift_minutes: int = Field(default=960, ge=480, le=1440)
    comp_cap: int = Field(default=4800, ge=0, le=20000)

    @model_validator(mode="after")
    def consistent(self) -> Rules:
        if self.double_minutes < self.daily_minutes:
            raise ValueError("Double-time threshold cannot precede daily overtime")
        if not (
            self.first_meal_minutes <= self.first_waiver_limit <= self.second_meal_minutes
            and self.second_meal_minutes <= self.second_waiver_limit
        ):
            raise ValueError("Meal thresholds and waiver limits contradict each other")
        return self


class PolicyDocument(Model):
    version: str = Field(min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")
    disclaimer: Literal["simplified mock policy, not legal advice"] = DISCLAIMER
    clauses: dict[str, str] = Field(min_length=11, max_length=11)
    rules: Rules


class ExceptionItem(Model):
    id: str
    family: Literal["missed_punch", "overtime_risk", "schedule_conflict", "policy_breach"]
    code: str
    reference: str
    title: str
    clause: str
    severity: Literal["critical", "warning", "info"]
    blocking: bool
    facts: dict = Field(default_factory=dict)


class TraceLine(Model):
    id: str
    week: str
    component: str
    label: str
    quantity: str
    unit: str
    rate: str
    unrounded: str
    amount: str
    formula: str
    clause: str
    sources: list[str] = Field(default_factory=list)


class PayResult(Model):
    status: Literal["complete", "incomplete"]
    total: str | None
    lines: list[TraceLine]
    exceptions: list[ExceptionItem]
    regular_rates: dict[str, str]
    work_minutes: int
    night_minutes: int
    overtime_minutes: int
    projected_minutes: dict[str, int | None]
    comp_events: list[dict]
    closing_comp_minutes: int | None
    reasons: list[str]
    policy_version: str
    disclaimer: str = DISCLAIMER


class ShiftEdit(Model):
    operation: Literal["add", "replace", "remove"]
    shift_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9._-]+$")
    start: datetime | None = None
    end: datetime | None = None
    breaks: list[Interval] = Field(default_factory=list, max_length=12)
    _aware = field_validator("start", "end")(aware)


class Correction(Model):
    edits: list[ShiftEdit] = Field(min_length=1, max_length=20)
    clauses: list[str] = Field(min_length=1, max_length=11)
    evidence: list[str] = Field(min_length=1, max_length=30)
    reason: str = Field(min_length=8, max_length=1000)

    @model_validator(mode="after")
    def unique_edits(self) -> Correction:
        ids = [edit.shift_id for edit in self.edits]
        if len(set(ids)) != len(ids):
            raise ValueError("Only one operation per shift is allowed")
        return self


class Investigation(Model):
    summary: str = Field(min_length=1, max_length=1200)
    clauses: list[str] = Field(min_length=1, max_length=11)
    evidence: list[str] = Field(min_length=1, max_length=30)
    correction: Correction | None = None


class CriticVerdict(Model):
    safe: StrictBool
    reason: str = Field(min_length=1, max_length=1000)
