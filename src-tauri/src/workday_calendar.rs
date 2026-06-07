use crate::error::{BackendError, BackendResult};
use chrono::{Datelike, NaiveDate, Weekday};
use serde::Deserialize;

const CN_WORKDAYS_2026: &str = include_str!("../resources/calendars/cn-workdays-2026.json");

#[derive(Debug, Deserialize)]
struct WorkdayCalendar {
    year: i32,
    holidays: Vec<String>,
    workdays: Vec<String>,
}

pub fn is_cn_legal_workday(date: NaiveDate) -> BackendResult<bool> {
    let calendar = load_2026_calendar()?;
    if date.year() != calendar.year {
        return Ok(is_weekday(date));
    }
    let value = date.format("%Y-%m-%d").to_string();
    if calendar.holidays.iter().any(|holiday| holiday == &value) {
        return Ok(false);
    }
    if calendar.workdays.iter().any(|workday| workday == &value) {
        return Ok(true);
    }
    Ok(is_weekday(date))
}

fn load_2026_calendar() -> BackendResult<WorkdayCalendar> {
    serde_json::from_str(CN_WORKDAYS_2026).map_err(|err| {
        BackendError::Database(format!("failed to load bundled workday calendar: {err}"))
    })
}

fn is_weekday(date: NaiveDate) -> bool {
    !matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn china_2026_calendar_handles_holidays_and_adjusted_workdays() {
        assert!(!is_cn_legal_workday(date("2026-01-01")).unwrap());
        assert!(is_cn_legal_workday(date("2026-01-04")).unwrap());
        assert!(is_cn_legal_workday(date("2026-02-14")).unwrap());
        assert!(!is_cn_legal_workday(date("2026-02-15")).unwrap());
        assert!(!is_cn_legal_workday(date("2026-10-04")).unwrap());
        assert!(is_cn_legal_workday(date("2026-10-10")).unwrap());
    }

    #[test]
    fn china_2026_calendar_falls_back_to_weekdays_for_unlisted_dates() {
        assert!(is_cn_legal_workday(date("2026-03-02")).unwrap());
        assert!(!is_cn_legal_workday(date("2026-03-07")).unwrap());
    }

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }
}
