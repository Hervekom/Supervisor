export function subtractWorkingDays(date: Date, days: number) {
  const d = new Date(date);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}
