// Manifest hours rule.
//
// The duration written onto a manifest is a SPAN from a start time to an end time,
// not a sum of Motive's on-duty totals. Both ends are derived separately:
//
//   Start  The manifest's scheduled start (start_at on the driver card).
//          If the driver went on duty early — by any amount — the scheduled time stands.
//          If he was late by no more than ON_TIME_GRACE_MIN he still counts as on time,
//          so the scheduled time stands. Later than that, his actual on-duty time is
//          rounded DOWN to the previous quarter hour.
//
//   End    His last off-duty of the day, rounded UP to the next quarter hour.
//
// Breaks and waiting time are deliberately left inside the span.

const MIN = 60_000;
const QUARTER = 15 * MIN;

const ON_TIME_GRACE_MIN = 7.5;

const floorQuarter = t => Math.floor(t / QUARTER) * QUARTER;
const ceilQuarter  = t => Math.ceil(t / QUARTER) * QUARTER;

// Everything is computed in "wall clock space": a UTC timestamp whose fields carry the
// local Eastern clock reading. Quarter-hour rounding and subtraction then work directly,
// and no daylight-saving arithmetic leaks into the result.
function wallClockConverter(timeZone) {
  const opts = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  };
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, ...opts });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', ...opts });
  }
  return function utcToWall(iso) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  };
}

// RoseRocket returns start_at already in the org's local time, with no zone suffix.
function localToWall(s) {
  const [datePart, timePart = '00:00:00'] = String(s).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [H, M, S = 0] = timePart.replace('Z', '').split(':').map(Number);
  return Date.UTC(y, m - 1, d, H, M, S || 0);
}

const wallToHHMM = t => new Date(t).toISOString().slice(11, 16);

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// events: Motive log events, each { type, start_time } (UTC ISO).
// Returns either { skip: reason } or the full working for display.
function computeHours({ scheduledStartLocal, events, timeZone = 'America/Toronto', endRounding = 'nearest' }) {
  if (!scheduledStartLocal) return { skip: 'manifest has no start time on the driver card' };

  const utcToWall = wallClockConverter(timeZone);
  const scheduled = localToWall(scheduledStartLocal);

  const timeline = (events ?? [])
    .map(e => e.event ?? e)
    .filter(e => e && e.start_time && e.type)
    .map(e => ({ type: e.type, at: utcToWall(e.start_time) }))
    .sort((a, b) => a.at - b.at);

  if (!timeline.length) return { skip: 'no Motive log events for this date' };

  const firstOnDuty = timeline.find(e => e.type !== 'off_duty' && e.type !== 'sleeper');
  if (!firstOnDuty) return { skip: 'driver never went on duty' };

  const offDuties = timeline.filter(e => e.type === 'off_duty' && e.at > firstOnDuty.at);
  const lastOffDuty = offDuties.length ? offDuties[offDuties.length - 1] : null;
  if (!lastOffDuty) {
    return { skip: 'driver never went off duty, so it needs an end time by hand' };
  }

  const lateByMin = (firstOnDuty.at - scheduled) / MIN;
  const onTime = lateByMin <= ON_TIME_GRACE_MIN;

  // Never start the clock before the scheduled time. This only bites when start_at
  // isn't itself on a quarter hour, where rounding down could otherwise reach back
  // past the time the driver was actually told to begin.
  const start = onTime ? scheduled : Math.max(scheduled, floorQuarter(firstOnDuty.at));
  const end = endRounding === 'up'
    ? ceilQuarter(lastOffDuty.at)
    : Math.round(lastOffDuty.at / QUARTER) * QUARTER;

  const seconds = (end - start) / 1000;
  if (seconds <= 0) return { skip: 'end time is not after the start time' };

  return {
    seconds,
    formatted: formatDuration(seconds),
    decimalHours: Math.round((seconds / 3600) * 100) / 100,
    onTime,
    lateByMin: Math.round(lateByMin * 10) / 10,
    working: {
      scheduled:     wallToHHMM(scheduled),
      firstOnDuty:   wallToHHMM(firstOnDuty.at),
      lastOffDuty:   wallToHHMM(lastOffDuty.at),
      startUsed:     wallToHHMM(start),
      endUsed:       wallToHHMM(end),
    },
  };
}

// The local calendar date a UTC timestamp falls on, for comparing a manifest's start
// against the moment it was completed.
function localDate(utcIso, timeZone = 'America/Toronto') {
  if (!utcIso) return null;
  return new Date(wallClockConverter(timeZone)(utcIso)).toISOString().slice(0, 10);
}

module.exports = { computeHours, formatDuration, localDate, ON_TIME_GRACE_MIN };
