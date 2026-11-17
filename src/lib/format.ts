export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

export function formatDate(value: string, withYear = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    ...(withYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function daysFromNow(value: string): string {
  const target = new Date(value);
  const now = new Date();
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1) return `${days} 天后`;
  if (days === -1) return "昨天";
  return `${Math.abs(days)} 天前`;
}
