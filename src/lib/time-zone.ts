/** Browser IANA zone, e.g. "Asia/Shanghai". */
export const localTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
