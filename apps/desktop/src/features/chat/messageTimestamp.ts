export function formatMessageTimestamp(timestamp: number, now: number = Date.now()): string {
  const messageDate = new Date(timestamp);
  const currentDate = new Date(now);
  const isToday =
    messageDate.getFullYear() === currentDate.getFullYear() &&
    messageDate.getMonth() === currentDate.getMonth() &&
    messageDate.getDate() === currentDate.getDate();

  if (isToday) {
    return messageDate.toLocaleTimeString();
  }

  return messageDate.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}
