<script>
  // Small stroke icon set (24px grid, drawn for this app).
  let { name, size = 18, class: cls = '' } = $props();
  const paths = {
    clients: 'M4 7.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M15 7.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M2.5 19c0-3 2-5 4-5s4 2 4 5M13.5 19c0-3 2-5 4-5s4 2 4 5',
    host: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    list: 'M4 6h16M4 12h16M4 18h16',
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    auto: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
    logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4l4 4M6 12h10',
    download: 'M12 4v11M7 10l5 5l5-5M5 20h14',
    copy: 'M9 9h10v11H9zM5 15V4h10',
    eye: 'M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7s-10-7-10-7zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.4M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
    power: 'M12 3v8M6.3 6.5a8 8 0 1 0 11.4 0',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    key: 'M8 14a4 4 0 1 1 0-8a4 4 0 1 1 0 8zM11 10h10M18 10v3M21 10v3',
    check: 'M5 12.5l4.5 4.5L19 7',
    chevron: 'M9 6l6 6l-6 6',
    up: 'M12 19V5M6 11l6-6l6 6',
    down: 'M12 5v14M6 13l6 6l6-6',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    flask: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10',
  };
</script>

<svg
  class={cls}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name]} /></svg>
